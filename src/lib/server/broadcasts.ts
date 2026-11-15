// Emails written in the dashboard and sent to the list. Requests on Workers are short, so the dashboard page
// sends in batches of 50 (one Resend call each). The recipients are fixed when sending starts and each one is
// marked as it goes, so a broadcast can be paused, resumed or retried and nobody gets it twice.
import { site } from '../../data/site';
import { UserError } from './api';
import { all, batch, newId, now, one, run, type Arg } from './db';
import { emailFooter, emailMarkdown, emailSettings, firstName, layout, markdownToText, NOT_SET_UP, personalLinks, sendMail, sendMany, type Mail } from './email';
import { getResource } from './resources';

export type BroadcastStatus = 'draft' | 'sending' | 'sent';

export interface Broadcast {
  id: string;
  subject: string;
  preheader: string;
  body: string;
  // "all", "confirmed" or "resource:<id>" (people who unlocked that resource)
  audience: string;
  status: BroadcastStatus;
  total: number;
  sent: number;
  failed: number;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface BroadcastInput {
  subject?: string;
  preheader?: string;
  body?: string;
  audience?: string;
}

type Row = Record<string, unknown>;
const n = (v: unknown) => (v == null ? null : Number(v));

function toBroadcast(r: Row): Broadcast {
  return {
    id: String(r.id),
    subject: String(r.subject ?? ''),
    preheader: String(r.preheader ?? ''),
    body: String(r.body ?? ''),
    audience: String(r.audience ?? 'all'),
    status: r.status as BroadcastStatus,
    total: Number(r.total ?? 0),
    sent: Number(r.sent ?? 0),
    failed: Number(r.failed ?? 0),
    note: (r.note as string) || null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    startedAt: n(r.started_at),
    finishedAt: n(r.finished_at),
  };
}

export async function listBroadcasts() {
  return (await all(`SELECT * FROM broadcasts ORDER BY COALESCE(started_at, updated_at) DESC LIMIT 200`)).map(toBroadcast);
}

export async function getBroadcast(id: string) {
  const r = await one(`SELECT * FROM broadcasts WHERE id = ?`, [id]);
  return r ? toBroadcast(r) : null;
}

async function mustGet(id: string) {
  const b = await getBroadcast(id);
  if (!b) throw new UserError('That email does not exist any more.', 404);
  return b;
}

function clean(input: BroadcastInput) {
  const v: Record<string, Arg> = {};
  if ('subject' in input) v.subject = String(input.subject ?? '').trim().slice(0, 200);
  if ('preheader' in input) v.preheader = String(input.preheader ?? '').trim().slice(0, 200);
  if ('body' in input) v.body = String(input.body ?? '').slice(0, 100_000);
  if ('audience' in input) {
    const a = String(input.audience ?? 'all');
    if (!/^(all|confirmed|resource:[a-f0-9]{16})$/.test(a)) throw new UserError('Pick who should get this email.');
    v.audience = a;
  }
  return v;
}

export async function createBroadcast(input: BroadcastInput = {}) {
  const v = clean(input);
  const id = newId();
  const t = now();
  const cols = Object.keys(v);
  await run(`INSERT INTO broadcasts (id, created_at, updated_at${cols.map((c) => `, ${c}`).join('')}) VALUES (?, ?, ?${cols.map(() => ', ?').join('')})`, [
    id,
    t,
    t,
    ...Object.values(v),
  ]);
  return (await getBroadcast(id))!;
}

export async function updateBroadcast(id: string, input: BroadcastInput) {
  const b = await mustGet(id);
  if (b.status !== 'draft') throw new UserError('This email has already gone out, so it can no longer be edited. Duplicate it instead.');
  const v = clean(input);
  const keys = Object.keys(v);
  if (keys.length) await run(`UPDATE broadcasts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...Object.values(v), now(), id]);
  return (await getBroadcast(id))!;
}

export async function duplicateBroadcast(id: string) {
  const b = await mustGet(id);
  return createBroadcast({ subject: b.subject, preheader: b.preheader, body: b.body, audience: b.audience });
}

export async function deleteBroadcast(id: string) {
  await run(`DELETE FROM broadcast_recipients WHERE broadcast_id = ?`, [id]);
  await run(`DELETE FROM broadcasts WHERE id = ?`, [id]);
}

// ---------- Audience ----------

function audienceWhere(audience: string): { sql: string; args: Arg[] } {
  if (audience === 'confirmed') return { sql: `s.status = 'subscribed' AND s.confirmed_at IS NOT NULL`, args: [] };
  if (audience.startsWith('resource:')) {
    return {
      sql: `s.status = 'subscribed' AND EXISTS (SELECT 1 FROM subscriber_events e WHERE e.subscriber_id = s.id AND e.resource_id = ? AND e.type = 'unlock')`,
      args: [audience.slice('resource:'.length)],
    };
  }
  return { sql: `s.status = 'subscribed'`, args: [] };
}

export async function audienceCount(audience: string) {
  const w = audienceWhere(audience);
  const r = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM subscribers s WHERE ${w.sql}`, w.args);
  return Number(r?.n ?? 0);
}

// The choices for "Send to", with how many people each one reaches right now.
export async function audienceOptions() {
  const [everyone, confirmed, resources] = await Promise.all([
    audienceCount('all'),
    audienceCount('confirmed'),
    all<{ id: string; title: string; n: number }>(
      `SELECT r.id, r.title, COUNT(DISTINCT s.id) AS n FROM resources r
       JOIN subscriber_events e ON e.resource_id = r.id AND e.type = 'unlock'
       JOIN subscribers s ON s.id = e.subscriber_id AND s.status = 'subscribed'
       GROUP BY r.id ORDER BY r.created_at DESC`,
    ),
  ]);
  return [
    { value: 'all', label: 'Everyone on the list', count: everyone },
    { value: 'confirmed', label: 'Confirmed addresses only', count: confirmed },
    ...resources.map((r) => ({ value: `resource:${r.id}`, label: `People who got “${r.title}”`, count: Number(r.n) })),
  ];
}

export async function audienceLabel(audience: string) {
  if (audience === 'all') return 'Everyone on the list';
  if (audience === 'confirmed') return 'Confirmed addresses only';
  const r = await getResource(audience.slice('resource:'.length));
  return r ? `People who got “${r.title}”` : 'People who got a deleted resource';
}

// ---------- Rendering ----------

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

// Rendered once per batch; personalise() then fills in each person's name and links.
export async function renderBroadcast(b: Pick<Broadcast, 'subject' | 'preheader' | 'body'>, origin: string): Promise<Rendered> {
  const host = new URL(origin).host;
  const reason = `You're getting this because you signed up for free resources at ${host}.`;
  const html = layout({
    title: b.subject,
    preheader: b.preheader,
    body: await emailMarkdown(b.body, origin),
    footer: emailFooter(reason, '%%UNSUB%%'),
  });
  const text = `${markdownToText(b.body, origin)}\n\n--\n${reason} Unsubscribe: %%UNSUB%%${site.postalAddress.trim() ? `\n${site.postalAddress.trim()}` : ''}`;
  return { subject: b.subject, html, text };
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// {{first_name}} and {{name}} work in the subject and the message.
function merge(s: string, person: { name: string }, html: boolean) {
  const first = firstName(person.name) || 'there';
  const full = person.name.trim() || first;
  const e = html ? escHtml : (x: string) => x;
  return s.replace(/\{\{\s*first_name\s*\}\}/gi, e(first)).replace(/\{\{\s*name\s*\}\}/gi, e(full));
}

async function personalise(r: Rendered, s: { id: string; email: string; name: string }, origin: string): Promise<Mail> {
  const links = await personalLinks(origin, s.id);
  const fill = (x: string, html: boolean) =>
    merge(x, s, html).replaceAll('%%ACCESS%%', encodeURIComponent(links.access)).replaceAll('%%UNSUB%%', links.unsubPage);
  return { to: s.email, subject: merge(r.subject, s, false), html: fill(r.html, true), text: fill(r.text, false), headers: links.headers };
}

// The preview in the editor, filled in for the person looking at it.
export async function previewBroadcast(b: Pick<Broadcast, 'subject' | 'preheader' | 'body'>, origin: string, name: string) {
  const r = await renderBroadcast(b, origin);
  const fill = (x: string, html: boolean) => merge(x, { name }, html).replaceAll('%%ACCESS%%', '').replaceAll('%%UNSUB%%', '#');
  return { subject: fill(r.subject, false), html: fill(r.html, true) };
}

export async function sendTest(b: Pick<Broadcast, 'subject' | 'preheader' | 'body'>, origin: string, to: { email: string; name: string }) {
  if (!emailSettings()) throw new UserError(NOT_SET_UP);
  if (!b.subject.trim() || !b.body.trim()) throw new UserError('Write a subject and a message first.');
  const r = await renderBroadcast(b, origin);
  const fill = (x: string, html: boolean) => merge(x, to, html).replaceAll('%%ACCESS%%', '').replaceAll('%%UNSUB%%', `${origin}/unsubscribe/`);
  const res = await sendMail({ to: to.email, subject: `[Test] ${fill(r.subject, false)}`, html: fill(r.html, true), text: fill(r.text, false) });
  if (!res.ok) throw new UserError(`Resend said: ${res.error}`);
}

// ---------- Sending ----------

const BATCH = 50;
// A batch claimed by a request that died this long ago goes back in the queue. A batch takes seconds.
const STALE = 2 * 60_000;

export interface Progress {
  status: BroadcastStatus;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  done: boolean;
  // Wait this long before the next batch (Resend allows a few requests per second).
  wait?: number;
  // Sending stopped and needs the person to look (e.g. the daily limit was reached).
  stopped?: string;
}

async function progress(id: string, extra: Partial<Progress> = {}): Promise<Progress> {
  const b = await mustGet(id);
  const p = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM broadcast_recipients WHERE broadcast_id = ? AND status IN ('pending', 'claimed')`, [id]);
  return { status: b.status, total: b.total, sent: b.sent, failed: b.failed, pending: Number(p?.n ?? 0), done: b.status === 'sent', ...extra };
}

export async function sendNextBatch(id: string, origin: string): Promise<Progress> {
  if (!emailSettings()) throw new UserError(NOT_SET_UP);
  let b = await mustGet(id);
  if (b.status === 'sent') return progress(id);

  if (b.status === 'draft') {
    if (!b.subject.trim() || !b.body.trim()) throw new UserError('Write a subject and a message first.');
    // Fix the list of recipients now, so people who join while it sends are not half-included.
    const w = audienceWhere(b.audience);
    await run(`INSERT OR IGNORE INTO broadcast_recipients (broadcast_id, subscriber_id) SELECT ?, s.id FROM subscribers s WHERE ${w.sql}`, [id, ...w.args]);
    const total = Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM broadcast_recipients WHERE broadcast_id = ?`, [id]))?.n ?? 0);
    if (!total) throw new UserError('Nobody matches this audience yet.');
    await run(`UPDATE broadcasts SET status = 'sending', total = ?, started_at = ?, updated_at = ?, note = NULL WHERE id = ? AND status = 'draft'`, [
      total,
      now(),
      now(),
      id,
    ]);
    b = await mustGet(id);
  }

  await run(`UPDATE broadcast_recipients SET status = 'pending', claimed_at = NULL WHERE broadcast_id = ? AND status = 'claimed' AND claimed_at < ?`, [
    id,
    now() - STALE,
  ]);
  // Claiming in one statement means two open tabs can never send to the same person.
  const claimed = await all<{ subscriber_id: string }>(
    `UPDATE broadcast_recipients SET status = 'claimed', claimed_at = ?
     WHERE broadcast_id = ? AND subscriber_id IN (SELECT subscriber_id FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'pending' LIMIT ?)
     RETURNING subscriber_id`,
    [now(), id, id, BATCH],
  );
  if (!claimed.length) {
    const left = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'claimed'`, [id]);
    if (Number(left?.n ?? 0) === 0) await run(`UPDATE broadcasts SET status = 'sent', finished_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id]);
    return progress(id, Number(left?.n ?? 0) ? { wait: 3000 } : {});
  }

  const ids = claimed.map((c) => c.subscriber_id);
  const people = await all<{ id: string; email: string; name: string; status: string }>(
    `SELECT id, email, name, status FROM subscribers WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  // Someone may have unsubscribed (or been deleted) since sending started.
  const active = people.filter((p) => p.status === 'subscribed');
  const gone = ids.filter((i) => !active.some((p) => p.id === i));

  const rendered = await renderBroadcast(b, origin);
  const mails = await Promise.all(active.map((p) => personalise(rendered, p, origin)));
  const results = await sendMany(mails);

  const t = now();
  const updates: { sql: string; args: Arg[] }[] = [];
  const mark = (subscriberId: string, status: string, error: string | null) =>
    updates.push({
      sql: `UPDATE broadcast_recipients SET status = ?, error = ?, sent_at = ?, claimed_at = NULL WHERE broadcast_id = ? AND subscriber_id = ?`,
      args: [status, error, status === 'sent' ? t : null, id, subscriberId],
    });
  let sent = 0;
  let failed = 0;
  let stopped: string | undefined;
  let wait = 600;
  results.forEach((r, i) => {
    const sid = active[i].id;
    if (r.ok) {
      sent++;
      mark(sid, 'sent', null);
    } else if (r.quota) {
      // Out of sending allowance: put them back and stop until the person resumes.
      mark(sid, 'pending', null);
      stopped = `Resend's sending limit was reached (${r.error}). Press Resume when it resets, or upgrade your Resend plan.`;
    } else if (r.retry) {
      mark(sid, 'pending', null);
      wait = 2500;
    } else {
      failed++;
      mark(sid, 'failed', r.error.slice(0, 300));
    }
  });
  for (const g of gone) mark(g, 'skipped', 'Unsubscribed before it was sent');
  updates.push({
    sql: `UPDATE broadcasts SET sent = sent + ?, failed = failed + ?, note = ?, updated_at = ? WHERE id = ?`,
    args: [sent, failed, stopped ?? null, t, id],
  });
  await batch(updates);
  return progress(id, { wait, stopped });
}

// Puts failed recipients back in the queue, e.g. after fixing the sending domain.
export async function retryFailed(id: string) {
  const b = await mustGet(id);
  const r = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'failed'`, [id]);
  const count = Number(r?.n ?? 0);
  if (!count) return progress(id);
  await batch([
    { sql: `UPDATE broadcast_recipients SET status = 'pending', error = NULL WHERE broadcast_id = ? AND status = 'failed'`, args: [id] },
    { sql: `UPDATE broadcasts SET status = 'sending', failed = MAX(0, failed - ?), finished_at = NULL, updated_at = ? WHERE id = ?`, args: [count, now(), b.id] },
  ]);
  return progress(id);
}

export async function failures(id: string, limit = 20) {
  return all<{ email: string; error: string }>(
    `SELECT s.email, r.error FROM broadcast_recipients r JOIN subscribers s ON s.id = r.subscriber_id
     WHERE r.broadcast_id = ? AND r.status = 'failed' LIMIT ?`,
    [id, limit],
  );
}
