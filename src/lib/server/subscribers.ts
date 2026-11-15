// The email list. Visitors join by unlocking a free resource with their name and email. Each address is
// stored once (no duplicates, whatever the capitalisation), and everything that happens to it is logged in
// subscriber_events: sign-up with the exact consent wording, page, IP and time, unlocks, downloads, emails,
// confirmations and unsubscribes. That log is the proof of consent email tools ask for when importing a list.
import type { AstroCookies } from 'astro';
import { getSecret } from 'astro:env/server';
import { emailConsent, newsletter } from '../../data/site';
import { UserError } from './api';
import { all, now, newId, one, run, type Arg } from './db';
import { emailSettings, firstName, resourceEmail, sendMail } from './email';
import { findLiveResource, resourcePath, type Resource } from './resources';
import { verify, sign } from './tokens';

export type SubscriberStatus = 'subscribed' | 'unsubscribed';

export interface Subscriber {
  id: string;
  email: string;
  name: string;
  status: SubscriberStatus;
  source: string | null;
  sourcePage: string | null;
  consent: string | null;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  createdAt: number;
  confirmedAt: number | null;
  confirmIp: string | null;
  unsubscribedAt: number | null;
  lastSeenAt: number | null;
}

// Who is making the request, recorded with each event.
export interface Visitor {
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  page?: string | null;
}

export function visitorFrom(request: Request, clientAddress?: () => string): Visitor {
  // Behind Hostinger's CDN the real visitor address arrives in a forwarded header.
  let ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip');
  try {
    ip ||= clientAddress?.() ?? null;
  } catch {}
  return {
    ip: ip || null,
    country: request.headers.get('cf-ipcountry') || request.headers.get('x-country-code') || null,
    userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
  };
}

type Row = Record<string, unknown>;
const n = (v: unknown) => (v == null ? null : Number(v));

function toSubscriber(r: Row): Subscriber {
  return {
    id: String(r.id),
    email: String(r.email),
    name: String(r.name ?? ''),
    status: r.status as SubscriberStatus,
    source: (r.source as string) || null,
    sourcePage: (r.source_page as string) || null,
    consent: (r.consent as string) || null,
    ip: (r.ip as string) || null,
    country: (r.country as string) || null,
    userAgent: (r.user_agent as string) || null,
    createdAt: Number(r.created_at),
    confirmedAt: n(r.confirmed_at),
    confirmIp: (r.confirm_ip as string) || null,
    unsubscribedAt: n(r.unsubscribed_at),
    lastSeenAt: n(r.last_seen_at),
  };
}

export async function getSubscriber(id: string) {
  const r = await one(`SELECT * FROM subscribers WHERE id = ?`, [id]);
  return r ? toSubscriber(r) : null;
}

async function logEvent(subscriberId: string, type: string, resource: { id: string } | null, detail: string, v: Visitor) {
  await run(
    `INSERT INTO subscriber_events (subscriber_id, type, resource_id, detail, page, ip, country, user_agent, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [subscriberId, type, resource?.id ?? null, detail.slice(0, 1000), v.page ?? null, v.ip, v.country, v.userAgent, now()],
  );
}

// ---------- "Remember me" on this browser ----------

const COOKIE = 'rk';
// Readable by scripts/gate.ts, so blog posts can say "welcome back" without being personalised on the server.
const NAME_COOKIE = 'rk_n';
const YEAR = 365 * 86_400;

export async function rememberVisitor(cookies: AstroCookies, s: Subscriber) {
  const opts = { path: '/', sameSite: 'lax' as const, secure: import.meta.env.PROD, maxAge: YEAR };
  cookies.set(COOKIE, await sign('access', s.id), { ...opts, httpOnly: true });
  cookies.set(NAME_COOKIE, firstName(s.name) || 'friend', opts);
}

export function forgetVisitor(cookies: AstroCookies) {
  cookies.delete(COOKIE, { path: '/' });
  cookies.delete(NAME_COOKIE, { path: '/' });
}

export async function visitorSubscriber(cookies: AstroCookies) {
  const id = await verify('access', cookies.get(COOKIE)?.value);
  return id ? getSubscriber(id) : null;
}

// ---------- Checks ----------

// Only the most common throwaway inbox services; the DNS check below catches made-up domains.
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com', 'tempmail.com',
  'temp-mail.org', 'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com',
  'throwawaymail.com', 'mintemail.com', 'mohmal.com', 'emailondeck.com', 'tempail.com', 'burnermail.io',
]);
const COMMON = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com',
  'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'ymail.com', 'gmx.com', 'zoho.com', 'yandex.com', 'mail.com',
]);
const EMAIL = /^[^\s@"<>(),;:[\]\\]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

function cleanName(v: unknown) {
  const s = String(v ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (!s) throw new UserError('Please enter your name.', 400, 'name');
  if (/https?:|www\.|@/i.test(s)) throw new UserError('Please enter just your name.', 400, 'name');
  return s;
}

function cleanEmail(v: unknown) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) throw new UserError('Please enter your email.', 400, 'email');
  if (s.length > 254 || !EMAIL.test(s)) throw new UserError('That email address does not look right.', 400, 'email');
  if (DISPOSABLE.has(s.split('@')[1])) throw new UserError('Please use your real email address, not a temporary one.', 400, 'email');
  return s;
}

// Asks Cloudflare's public DNS whether the domain can receive email, which catches typos like "gmial.co".
// If the lookup itself fails, the address is let through rather than turning a real person away.
const domainOk = new Map<string, boolean>();
async function domainAcceptsMail(domain: string) {
  if (COMMON.has(domain)) return true;
  const cached = domainOk.get(domain);
  if (cached !== undefined) return cached;
  try {
    const ask = async (type: string) => {
      const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(2500),
      });
      return (await res.json()) as { Status: number; Answer?: { type: number }[] };
    };
    const mx = await ask('MX');
    let ok = mx.Status === 0 && Boolean(mx.Answer?.some((a) => a.type === 15));
    // No MX record: mail goes to the domain's own address, if it has one.
    if (!ok && mx.Status === 0) ok = Boolean((await ask('A')).Answer?.some((a) => a.type === 1));
    domainOk.set(domain, ok);
    return ok;
  } catch {
    return true;
  }
}

// At most `max` actions per key in the window. Old rows are cleared now and then.
async function tooMany(key: string, max: number, windowMs: number) {
  const t = now();
  const row = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM rate_limits WHERE key = ? AND at > ?`, [key, t - windowMs]);
  if (Number(row?.n ?? 0) >= max) return true;
  await run(`INSERT INTO rate_limits (key, at) VALUES (?, ?)`, [key, t]);
  if (Math.random() < 0.05) await run(`DELETE FROM rate_limits WHERE at < ?`, [t - 86_400_000]);
  return false;
}

// ---------- Unlocking a resource ----------

export interface UnlockInput {
  name?: unknown;
  email?: unknown;
  resource?: unknown;
  page?: unknown;
  hp?: unknown;
  ts?: unknown;
}

const consentRecord = () => `${emailConsent.text} [wording version ${emailConsent.version}]`;

export async function unlockResource(
  input: UnlockInput,
  visitor: Visitor,
  o: { origin: string; defer: (p: Promise<unknown>) => void },
): Promise<{ subscriber: Subscriber; resource: Resource; isNew: boolean; emailed: boolean }> {
  // People never see the "hp" field and need more than a moment to type; bots fill everything instantly.
  const ts = Number(input.ts);
  if (String(input.hp ?? '').trim() || (ts && now() - ts < 1500)) {
    throw new UserError('Something went wrong. Please try again.', 400, 'bot');
  }
  if (await tooMany(`subscribe:${visitor.ip ?? 'unknown'}`, 20, 15 * 60_000)) {
    throw new UserError('Too many requests from your network. Please wait a few minutes and try again.', 429, 'rate');
  }
  const name = cleanName(input.name);
  const email = cleanEmail(input.email);
  const found = await findLiveResource(String(input.resource ?? ''));
  if (!found) throw new UserError('This resource is not available any more.', 404, 'gone');
  const domain = email.split('@')[1];
  if (!(await domainAcceptsMail(domain))) {
    throw new UserError(`Emails can't be delivered to ${domain}. Check the address for typos.`, 400, 'domain');
  }

  const v: Visitor = { ...visitor, page: String(input.page ?? '').slice(0, 300) || resourcePath(found.resource.slug) };
  const resource = found.resource;
  const { subscriber, isNew } = await upsert(name, email, resource, v);
  await recordUnlock(subscriber, resource, v);

  let emailed = false;
  if (emailSettings() && (await recentEmails(subscriber.id)) < 3) {
    emailed = true;
    o.defer(deliver(subscriber, resource, isNew, o.origin, v));
  }
  o.defer(forwardToKit(subscriber));
  o.defer(notifyWebhook('resource.unlocked', { isNew, subscriber: publicSubscriber(subscriber), resource: publicResource(resource, o.origin) }));
  return { subscriber, resource, isNew, emailed };
}

// One row per address. A new address is added; a known one is never copied, and someone who had
// unsubscribed is subscribed again, because they just agreed to the wording again.
async function upsert(name: string, email: string, r: Resource, v: Visitor) {
  const t = now();
  const consent = consentRecord();
  const id = newId();
  const res = await run(
    `INSERT INTO subscribers (id, email, name, status, source, source_page, consent, ip, country, user_agent, created_at, last_seen_at)
     VALUES (?, ?, ?, 'subscribed', ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`,
    [id, email, name, r.title, v.page ?? null, consent, v.ip, v.country, v.userAgent, t, t],
  );
  if (res.meta.changes) {
    await logEvent(id, 'signup', r, `Signed up for “${r.title}” and agreed to: ${consent}`, v);
    return { subscriber: (await getSubscriber(id))!, isNew: true };
  }
  const s = toSubscriber((await one(`SELECT * FROM subscribers WHERE email = ?`, [email]))!);
  if (s.status === 'unsubscribed') {
    await run(`UPDATE subscribers SET status = 'subscribed', unsubscribed_at = NULL, consent = ?, last_seen_at = ? WHERE id = ?`, [consent, t, s.id]);
    await logEvent(s.id, 'resubscribe', r, `Signed up again for “${r.title}” and agreed to: ${consent}`, v);
  } else {
    await run(`UPDATE subscribers SET last_seen_at = ? WHERE id = ?`, [t, s.id]);
  }
  if (!s.name && name) await run(`UPDATE subscribers SET name = ? WHERE id = ?`, [name, s.id]);
  return { subscriber: (await getSubscriber(s.id))!, isNew: false };
}

// Logged once per person and resource, however often they come back to it.
export async function recordUnlock(s: Subscriber, r: Resource, v: Visitor) {
  const seen = await one(`SELECT 1 AS x FROM subscriber_events WHERE subscriber_id = ? AND resource_id = ? AND type = 'unlock' LIMIT 1`, [s.id, r.id]);
  if (!seen) await logEvent(s.id, 'unlock', r, r.title, v);
}

export async function recordDownload(s: Subscriber, r: Resource, filename: string, v: Visitor) {
  await logEvent(s.id, 'download', r, filename, v);
}

// Caps delivery emails per address, so nobody can flood someone's inbox by typing their address.
async function recentEmails(subscriberId: string) {
  const row = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM subscriber_events WHERE subscriber_id = ? AND type = 'email' AND at > ?`, [
    subscriberId,
    now() - 3_600_000,
  ]);
  return Number(row?.n ?? 0);
}

async function deliver(s: Subscriber, r: Resource, isNew: boolean, origin: string, v: Visitor) {
  try {
    const res = await sendMail(await resourceEmail({ subscriber: s, resource: r, isNew, origin }));
    await logEvent(s.id, res.ok ? 'email' : 'email_failed', r, res.ok ? `Sent “${r.title}”` : `Could not send “${r.title}”: ${res.error}`, v);
  } catch (e) {
    console.error('Delivery email failed', e);
  }
}

// Opening a link from one of our emails proves the address belongs to this person.
export async function confirmFromEmail(s: Subscriber, v: Visitor) {
  if (s.confirmedAt) return;
  await run(`UPDATE subscribers SET confirmed_at = ?, confirm_ip = ? WHERE id = ? AND confirmed_at IS NULL`, [now(), v.ip, s.id]);
  await logEvent(s.id, 'confirm', null, 'Opened a link in an email, which confirms the address is theirs', v);
}

export async function seen(s: Subscriber) {
  await run(`UPDATE subscribers SET last_seen_at = ? WHERE id = ?`, [now(), s.id]);
}

// ---------- Unsubscribing ----------

export async function unsubscribe(id: string, v: Visitor, how: string) {
  const s = await getSubscriber(id);
  if (!s) return null;
  if (s.status !== 'unsubscribed') {
    await run(`UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?`, [now(), id]);
    await logEvent(id, 'unsubscribe', null, how, v);
    await notifyWebhook('subscriber.unsubscribed', { subscriber: publicSubscriber({ ...s, status: 'unsubscribed' }) });
  }
  return (await getSubscriber(id))!;
}

export async function subscriberFromUnsubToken(token: string | null) {
  const id = await verify('unsub', token);
  return id ? getSubscriber(id) : null;
}

// ---------- Webhook (optional) ----------

const publicSubscriber = (s: Subscriber) => ({
  id: s.id,
  email: s.email,
  name: s.name,
  firstName: firstName(s.name),
  status: s.status,
  createdAt: new Date(s.createdAt).toISOString(),
  confirmed: Boolean(s.confirmedAt),
  source: s.source,
  country: s.country,
});
const publicResource = (r: Resource, origin: string) => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  kind: r.kind,
  url: new URL(resourcePath(r.slug), origin).href,
});

// Copies every sign-up into Nafay's Kit newsletter form (the same one his homepage uses), so the AI Brief keeps
// growing. Kit ignores addresses it already has. The form id comes from `newsletter.kitFormId` in src/data/site.ts; the
// KIT_FORM_ID variable overrides it, and KIT_FORM_ID=off turns forwarding off (use that on your own computer).
async function forwardToKit(s: Subscriber) {
  const formId = (getSecret('KIT_FORM_ID') || newsletter.kitFormId).trim();
  if (!formId || formId.toLowerCase() === 'off') return;
  try {
    const fd = new FormData();
    fd.append('email_address', s.email);
    if (s.name) fd.append('first_name', s.name.split(/\s+/)[0]);
    await fetch(`https://app.kit.com/forms/${encodeURIComponent(formId)}/subscriptions`, { method: 'POST', body: fd, signal: AbortSignal.timeout(8000) });
  } catch (e) {
    console.error('Kit forward failed', e);
  }
}

// Sends each sign-up and unsubscribe to LEADS_WEBHOOK_URL, e.g. an n8n or Zapier webhook that adds the person
// to another email tool or a Google Sheet.
async function notifyWebhook(event: string, payload: Record<string, unknown>) {
  const url = getSecret('LEADS_WEBHOOK_URL')?.trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, at: new Date().toISOString(), ...payload }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error('Webhook failed', e);
  }
}

// ---------- Dashboard ----------

export type Filter = { search?: string; status?: string; resource?: string };

function filterSql(f: Filter): { where: string; args: Arg[] } {
  const where: string[] = [];
  const args: Arg[] = [];
  if (f.status === 'subscribed' || f.status === 'unsubscribed') {
    where.push('s.status = ?');
    args.push(f.status);
  }
  if (f.status === 'confirmed') where.push(`s.status = 'subscribed' AND s.confirmed_at IS NOT NULL`);
  if (f.search) {
    where.push('(s.email LIKE ? OR s.name LIKE ?)');
    args.push(`%${f.search}%`, `%${f.search}%`);
  }
  if (f.resource) {
    where.push(`EXISTS (SELECT 1 FROM subscriber_events e WHERE e.subscriber_id = s.id AND e.resource_id = ? AND e.type = 'unlock')`);
    args.push(f.resource);
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

export async function listSubscribers(f: Filter & { limit?: number; offset?: number }) {
  const { where, args } = filterSql(f);
  const total = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM subscribers s ${where}`, args);
  const rows = await all(
    `SELECT s.*, (SELECT COUNT(DISTINCT resource_id) FROM subscriber_events e WHERE e.subscriber_id = s.id AND e.type = 'unlock') AS unlocks
     FROM subscribers s ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    [...args, f.limit ?? 50, f.offset ?? 0],
  );
  return { subscribers: rows.map((r) => ({ ...toSubscriber(r), unlocks: Number(r.unlocks ?? 0) })), total: Number(total?.n ?? 0) };
}

export async function subscriberCounts() {
  const week = now() - 7 * 86_400_000;
  const r = await one<Record<string, number>>(
    `SELECT
       SUM(CASE WHEN status = 'subscribed' THEN 1 ELSE 0 END) AS subscribed,
       SUM(CASE WHEN status = 'subscribed' AND confirmed_at IS NOT NULL THEN 1 ELSE 0 END) AS confirmed,
       SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed,
       SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS week,
       COUNT(*) AS everyone
     FROM subscribers`,
    [week],
  );
  const k = (key: string) => Number(r?.[key] ?? 0);
  return { subscribed: k('subscribed'), confirmed: k('confirmed'), unsubscribed: k('unsubscribed'), week: k('week'), everyone: k('everyone') };
}

export async function signupsByDay(days = 30) {
  const since = Date.now() - (days - 1) * 86_400_000;
  const rows = await all<{ day: string; n: number }>(
    `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM subscribers WHERE created_at >= ? GROUP BY day`,
    [new Date(new Date(since).toISOString().slice(0, 10)).getTime()],
  );
  const map = new Map(rows.map((r) => [String(r.day), Number(r.n)]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, count: map.get(day) ?? 0 };
  });
}

export interface SubscriberEvent {
  id: number;
  type: string;
  resourceId: string | null;
  detail: string;
  page: string | null;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  at: number;
}

export async function subscriberHistory(id: string) {
  const [events, emails] = await Promise.all([
    all(`SELECT * FROM subscriber_events WHERE subscriber_id = ? ORDER BY at DESC, id DESC LIMIT 500`, [id]),
    all<{ subject: string; status: string; sent_at: number | null; error: string | null }>(
      `SELECT b.subject, r.status, r.sent_at, r.error FROM broadcast_recipients r JOIN broadcasts b ON b.id = r.broadcast_id
       WHERE r.subscriber_id = ? ORDER BY COALESCE(r.sent_at, b.started_at) DESC LIMIT 200`,
      [id],
    ),
  ]);
  return {
    events: events.map(
      (e): SubscriberEvent => ({
        id: Number(e.id),
        type: String(e.type),
        resourceId: (e.resource_id as string) || null,
        detail: String(e.detail ?? ''),
        page: (e.page as string) || null,
        ip: (e.ip as string) || null,
        country: (e.country as string) || null,
        userAgent: (e.user_agent as string) || null,
        at: Number(e.at),
      }),
    ),
    emails,
  };
}

// For someone who asks to be forgotten: removes the person and their whole history.
export async function deleteSubscriber(id: string) {
  await run(`DELETE FROM subscriber_events WHERE subscriber_id = ?`, [id]);
  await run(`DELETE FROM broadcast_recipients WHERE subscriber_id = ?`, [id]);
  await run(`DELETE FROM subscribers WHERE id = ?`, [id]);
}

// Spreadsheet apps run cells that start with = + - @ as formulas, so those get a leading apostrophe.
const cell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const iso = (ms: unknown) => (ms == null ? '' : new Date(Number(ms)).toISOString());

// Every column an email tool needs to import the list, including the proof of consent for each person.
export async function exportCsv(f: Filter) {
  const { where, args } = filterSql(f);
  const rows = await all(
    `SELECT s.*,
       (SELECT GROUP_CONCAT(detail, '; ') FROM (SELECT DISTINCT detail FROM subscriber_events e WHERE e.subscriber_id = s.id AND e.type = 'unlock')) AS resources
     FROM subscribers s ${where} ORDER BY s.created_at`,
    args,
  );
  const head = [
    'email', 'name', 'first_name', 'status', 'opt_in_time', 'opt_in_ip', 'opt_in_country', 'opt_in_source', 'opt_in_page',
    'consent_text', 'confirm_time', 'confirm_ip', 'unsubscribed_time', 'resources', 'last_seen',
  ];
  const lines = rows.map((r) =>
    [
      r.email, r.name, firstName(String(r.name ?? '')), r.status, iso(r.created_at), r.ip, r.country, r.source, r.source_page,
      r.consent, iso(r.confirmed_at), r.confirm_ip, iso(r.unsubscribed_at), r.resources, iso(r.last_seen_at),
    ]
      .map(cell)
      .join(','),
  );
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}

export async function latestSubscribers(limit = 5) {
  return (await all(`SELECT * FROM subscribers ORDER BY created_at DESC LIMIT ?`, [limit])).map(toSubscriber);
}
