// Free resources: prompts, templates, guides, links and files that visitors unlock with their name and email.
// The dashboard, the MCP server and the public pages all go through these functions, so they behave the same.
import { Buffer } from 'node:buffer';
import { emailConsent } from '../../data/site';
import { youtubeId } from '../youtube';
import { UserError } from './api';
import { all, newId, now, one, run, type Arg } from './db';
import { parseTags, plainText, slugify } from './posts';

export const KINDS = {
  prompt: 'Prompt',
  template: 'Template',
  guide: 'Guide',
  checklist: 'Checklist',
  workflow: 'Workflow',
  tool: 'Tool',
  other: 'Resource',
} as const;
export type Kind = keyof typeof KINDS;
export type Status = 'draft' | 'published';

export interface Resource {
  id: string;
  slug: string;
  oldSlugs: string[];
  title: string;
  kind: Kind;
  // Public: shown on cards and above the form.
  summary: string;
  // Only shown after sign-up: Markdown (prompts go in ``` blocks), a main link and files.
  content: string;
  linkUrl: string | null;
  linkLabel: string | null;
  videoId: string | null;
  videoTitle: string | null;
  coverImage: string | null;
  tags: string[];
  // Extra words people might search for, like a video's old title.
  keywords: string;
  status: Status;
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

// What the dashboard and the MCP tools may send. Every field is optional on update.
export interface ResourceInput {
  title?: string;
  slug?: string;
  kind?: string;
  summary?: string;
  content?: string;
  linkUrl?: string | null;
  linkLabel?: string | null;
  // Any YouTube link, or the bare 11-character video id.
  videoUrl?: string | null;
  videoTitle?: string | null;
  coverImage?: string | null;
  tags?: string[] | string;
  keywords?: string;
  status?: Status;
  publishedAt?: number | string | null;
}

type Row = Record<string, unknown>;

function toResource(r: Row): Resource {
  return {
    id: String(r.id),
    slug: String(r.slug),
    oldSlugs: JSON.parse(String(r.old_slugs || '[]')),
    title: String(r.title),
    kind: (String(r.kind) in KINDS ? r.kind : 'other') as Kind,
    summary: String(r.summary ?? ''),
    content: String(r.content ?? ''),
    linkUrl: (r.link_url as string) || null,
    linkLabel: (r.link_label as string) || null,
    videoId: (r.video_id as string) || null,
    videoTitle: (r.video_title as string) || null,
    coverImage: (r.cover_image as string) || null,
    tags: JSON.parse(String(r.tags || '[]')),
    keywords: String(r.keywords ?? ''),
    status: r.status as Status,
    publishedAt: r.published_at == null ? null : Number(r.published_at),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export const kindLabel = (k: Kind) => KINDS[k] ?? KINDS.other;
// "prompt", as in "Get the free prompt".
export const kindWord = (k: Kind) => kindLabel(k).toLowerCase();
export const resourcePath = (slug: string) => `/resources/${slug}/`;
// The link for YouTube descriptions. It keeps working when the video, the resource or its slug is renamed.
export const shortPath = (slug: string) => `/r/${slug}`;
export const coverOf = (r: Pick<Resource, 'coverImage' | 'videoId'>) =>
  r.coverImage || (r.videoId ? `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg` : null);

// Like posts, a published resource with a future date is scheduled and goes live at that time.
export const isLive = (r: Resource, at = now()) => r.status === 'published' && r.publishedAt != null && r.publishedAt <= at;
export function resourceState(r: Resource): 'draft' | 'scheduled' | 'published' {
  if (r.status !== 'published') return 'draft';
  return isLive(r) ? 'published' : 'scheduled';
}

// ---------- Reading ----------

const LIVE = `status = 'published' AND published_at <= ?`;

export async function getResource(idOrSlug: string): Promise<Resource | null> {
  const r = await one(`SELECT * FROM resources WHERE id = ? OR slug = ?`, [idOrSlug, idOrSlug]);
  return r ? toResource(r) : null;
}

// A live resource by its slug, or by a slug it used to have (`moved` is then true, so the page can redirect).
export async function findLiveResource(slug: string): Promise<{ resource: Resource; moved: boolean } | null> {
  const s = slug.trim().toLowerCase();
  if (!s) return null;
  const t = now();
  const r = await one(`SELECT * FROM resources WHERE slug = ? AND ${LIVE}`, [s, t]);
  if (r) return { resource: toResource(r), moved: false };
  const old = await one(
    `SELECT resources.* FROM resources, json_each(resources.old_slugs) WHERE json_each.value = ? AND ${LIVE} LIMIT 1`,
    [s, t],
  );
  return old ? { resource: toResource(old), moved: true } : null;
}

export async function liveResources(o: { kind?: string; limit?: number } = {}): Promise<Resource[]> {
  const kind = o.kind && o.kind in KINDS ? o.kind : null;
  const rows = await all(
    `SELECT * FROM resources WHERE ${LIVE}${kind ? ' AND kind = ?' : ''} ORDER BY published_at DESC LIMIT ?`,
    kind ? [now(), kind, o.limit ?? 500] : [now(), o.limit ?? 500],
  );
  return rows.map(toResource);
}

export async function liveKinds(): Promise<{ kind: Kind; count: number }[]> {
  const rows = await all<{ kind: string; n: number }>(`SELECT kind, COUNT(*) AS n FROM resources WHERE ${LIVE} GROUP BY kind ORDER BY n DESC`, [now()]);
  return rows.filter((r) => r.kind in KINDS).map((r) => ({ kind: r.kind as Kind, count: Number(r.n) }));
}

// The newest live resource made from each of these YouTube videos.
export async function resourcesForVideos(ids: string[]): Promise<Map<string, Resource>> {
  const out = new Map<string, Resource>();
  const list = [...new Set(ids)].slice(0, 50);
  if (!list.length) return out;
  const rows = await all(
    `SELECT * FROM resources WHERE ${LIVE} AND video_id IN (${list.map(() => '?').join(',')}) ORDER BY published_at DESC`,
    [now(), ...list],
  );
  for (const r of rows.map(toResource)) if (r.videoId && !out.has(r.videoId)) out.set(r.videoId, r);
  return out;
}

export interface ListOptions {
  state?: 'all' | 'draft' | 'scheduled' | 'published';
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listResources(o: ListOptions = {}): Promise<{ resources: Resource[]; total: number }> {
  const where: string[] = [];
  const args: Arg[] = [];
  if (o.state === 'draft') where.push(`status = 'draft'`);
  if (o.state === 'scheduled') {
    where.push(`status = 'published' AND published_at > ?`);
    args.push(now());
  }
  if (o.state === 'published') {
    where.push(LIVE);
    args.push(now());
  }
  if (o.search) {
    where.push(`(title LIKE ? OR summary LIKE ? OR slug LIKE ? OR video_title LIKE ? OR video_id = ?)`);
    const q = `%${o.search}%`;
    args.push(q, q, q, q, youtubeId(o.search) ?? o.search);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM resources ${clause}`, args);
  const rows = await all(
    `SELECT * FROM resources ${clause} ORDER BY COALESCE(published_at, updated_at) DESC LIMIT ? OFFSET ?`,
    [...args, o.limit ?? 50, o.offset ?? 0],
  );
  return { resources: rows.map(toResource), total: Number(total?.n ?? 0) };
}

export async function resourceCounts() {
  const t = now();
  const r = await one<Record<string, number>>(
    `SELECT
       SUM(CASE WHEN status = 'published' AND published_at <= ? THEN 1 ELSE 0 END) AS published,
       SUM(CASE WHEN status = 'published' AND published_at > ? THEN 1 ELSE 0 END) AS scheduled,
       SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft
     FROM resources`,
    [t, t],
  );
  const n = (k: string) => Number(r?.[k] ?? 0);
  return { published: n('published'), scheduled: n('scheduled'), draft: n('draft') };
}

// ---------- Writing ----------

const clean = (v: unknown, max: number) => (v == null ? null : String(v).trim().slice(0, max) || null);

function checkUrl(v: string | null, field: string) {
  if (v && !/^(https?:\/\/|\/)/.test(v)) throw new UserError(`${field} must be a full URL (https://…) or a path starting with /.`);
  return v;
}

function parseDate(v: ResourceInput['publishedAt']): number | null {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? v : Date.parse(v);
  if (Number.isNaN(d)) throw new UserError(`"${v}" is not a valid date. Use ISO format, e.g. 2025-02-12.`);
  return d;
}

async function uniqueSlug(base: string, exceptId?: string) {
  const root = slugify(base) || 'resource';
  let slug = root;
  for (let i = 2; ; i++) {
    const hit = await one(`SELECT id FROM resources WHERE slug = ? AND id != ?`, [slug, exceptId ?? '']);
    if (!hit) return slug;
    slug = `${root}-${i}`;
  }
}

// YouTube's oEmbed endpoint gives a video's current title without an API key.
export async function fetchVideoTitle(id: string): Promise<string | null> {
  try {
    const watch = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${watch}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    return clean(data.title, 200);
  } catch {
    return null;
  }
}

const COLUMNS: Record<string, string> = {
  title: 'title',
  slug: 'slug',
  oldSlugs: 'old_slugs',
  kind: 'kind',
  summary: 'summary',
  content: 'content',
  linkUrl: 'link_url',
  linkLabel: 'link_label',
  videoId: 'video_id',
  videoTitle: 'video_title',
  coverImage: 'cover_image',
  tags: 'tags',
  keywords: 'keywords',
  status: 'status',
  publishedAt: 'published_at',
};

// Turns raw input into column values, validating as it goes.
async function normalise(input: ResourceInput, existing?: Resource): Promise<Record<string, Arg>> {
  const v: Record<string, Arg> = {};
  if ('title' in input) {
    const title = clean(input.title, 160);
    if (!title) throw new UserError('A resource needs a title.');
    v.title = title;
  }
  if ('slug' in input || !existing) {
    const wanted = clean(input.slug, 80) ?? (v.title as string) ?? existing?.title ?? '';
    v.slug = await uniqueSlug(wanted, existing?.id);
    // The old address keeps working, so links already in video descriptions never break.
    if (existing && v.slug !== existing.slug) {
      v.oldSlugs = JSON.stringify([existing.slug, ...existing.oldSlugs.filter((s) => s !== v.slug && s !== existing.slug)].slice(0, 20));
    }
  }
  if ('kind' in input) {
    if (!(String(input.kind) in KINDS)) throw new UserError(`Type must be one of: ${Object.keys(KINDS).join(', ')}.`);
    v.kind = String(input.kind);
  }
  if ('summary' in input) v.summary = clean(input.summary, 300) ?? '';
  if ('content' in input) v.content = String(input.content ?? '');
  if ('linkUrl' in input) v.linkUrl = checkUrl(clean(input.linkUrl, 1000), 'The link');
  if ('linkLabel' in input) v.linkLabel = clean(input.linkLabel, 60);
  if ('videoUrl' in input) {
    const raw = clean(input.videoUrl, 300);
    const id = raw ? (youtubeId(raw) ?? (/^[\w-]{11}$/.test(raw) ? raw : null)) : null;
    if (raw && !id) throw new UserError('That does not look like a YouTube video link.');
    v.videoId = id;
  }
  // The video's title is saved when it is linked, so it stays searchable even after the video is renamed.
  if ('videoTitle' in input || 'videoId' in v) {
    const videoId = 'videoId' in v ? (v.videoId as string | null) : (existing?.videoId ?? null);
    const given = clean(input.videoTitle, 200);
    if (!videoId) v.videoTitle = null;
    else if (given) v.videoTitle = given;
    else if (videoId !== existing?.videoId || !existing?.videoTitle || 'videoTitle' in input) v.videoTitle = await fetchVideoTitle(videoId);
  }
  if ('coverImage' in input) v.coverImage = checkUrl(clean(input.coverImage, 500), 'The cover image');
  if ('tags' in input) v.tags = JSON.stringify(parseTags(input.tags));
  if ('keywords' in input) v.keywords = clean(input.keywords, 500) ?? '';
  if ('status' in input) {
    if (input.status !== 'draft' && input.status !== 'published') throw new UserError('Status must be draft or published.');
    v.status = input.status;
  }
  if ('publishedAt' in input) v.publishedAt = parseDate(input.publishedAt);
  // Publishing without a date means "now".
  const status = (v.status as Status | undefined) ?? existing?.status ?? 'draft';
  const date = 'publishedAt' in v ? v.publishedAt : existing?.publishedAt;
  if (status === 'published' && date == null) v.publishedAt = now();
  return v;
}

export async function createResource(input: ResourceInput): Promise<Resource> {
  if (!clean(input.title, 160)) throw new UserError('A resource needs a title.');
  const v = await normalise({ status: 'draft', kind: 'prompt', ...input });
  const id = newId();
  const t = now();
  const cols = Object.keys(v).map((k) => COLUMNS[k]);
  await run(
    `INSERT INTO resources (id, created_at, updated_at, ${cols.join(', ')}) VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')})`,
    [id, t, t, ...Object.values(v)],
  );
  return (await getResource(id))!;
}

export async function updateResource(idOrSlug: string, input: ResourceInput): Promise<Resource> {
  const existing = await getResource(idOrSlug);
  if (!existing) throw new UserError(`No resource found for "${idOrSlug}".`, 404);
  const v = await normalise(input, existing);
  const keys = Object.keys(v);
  if (keys.length) {
    await run(`UPDATE resources SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [
      ...Object.values(v),
      now(),
      existing.id,
    ]);
  }
  return (await getResource(existing.id))!;
}

// Deletes the resource and its files. Who unlocked it stays in each subscriber's history.
export async function deleteResource(idOrSlug: string) {
  const r = await getResource(idOrSlug);
  if (!r) throw new UserError(`No resource found for "${idOrSlug}".`, 404);
  for (const f of await listFiles(r.id)) await deleteFile(f.id);
  await run(`DELETE FROM resource_views WHERE resource_id = ?`, [r.id]);
  await run(`DELETE FROM resources WHERE id = ?`, [r.id]);
  return r;
}

// ---------- Files ----------

// Files live in D1 in pieces, so no extra storage service is needed. For anything over 20 MB, use a
// Google Drive (or similar) link instead.
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
// 1.4 MB per piece is about 1.87 MB as base64, under D1's 2 MB limit per value.
const CHUNK = 1_400_000;
// Files that could run code in a browser or on a computer are refused.
const BLOCKED = /\.(html?|xht(ml)?|svg|js|mjs|exe|msi|bat|cmd|com|scr|ps1|sh|vbs|jar|apk|dll|app|dmg)$/i;
const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  zip: 'application/zip',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
};

export interface ResourceFile {
  id: string;
  resourceId: string;
  filename: string;
  mime: string;
  size: number;
  chunks: number;
  createdAt: number;
  url: string;
}

export const fileUrl = (id: string, filename: string) => `/files/${id}/${encodeURIComponent(filename)}`;
export const fileSize = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const fileName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-120) || 'file';

function toFile(r: Row): ResourceFile {
  return {
    id: String(r.id),
    resourceId: String(r.resource_id),
    filename: String(r.filename),
    mime: String(r.mime),
    size: Number(r.size),
    chunks: Number(r.chunks),
    createdAt: Number(r.created_at),
    url: fileUrl(String(r.id), String(r.filename)),
  };
}

export async function listFiles(resourceId: string): Promise<ResourceFile[]> {
  return (await all(`SELECT * FROM resource_files WHERE resource_id = ? ORDER BY created_at`, [resourceId])).map(toFile);
}

export async function getFile(id: string): Promise<ResourceFile | null> {
  const r = await one(`SELECT * FROM resource_files WHERE id = ?`, [id]);
  return r ? toFile(r) : null;
}

export async function saveFile(resourceId: string, f: { bytes: Uint8Array; filename: string; mime?: string }): Promise<ResourceFile> {
  const filename = fileName(f.filename);
  if (BLOCKED.test(filename)) throw new UserError('That type of file is not allowed. Zip it first, or share it with a link.');
  if (!f.bytes.byteLength) throw new UserError('The file is empty.');
  if (f.bytes.byteLength > MAX_FILE_BYTES) {
    throw new UserError(`Files can be up to ${fileSize(MAX_FILE_BYTES)}. Share bigger ones with a Google Drive link instead.`);
  }
  if (!(await getResource(resourceId))) throw new UserError('Save the resource before adding files.', 404);
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mime = TYPES[ext] ?? (f.mime?.split(';')[0].trim() || 'application/octet-stream');
  const id = newId();
  const chunks = Math.ceil(f.bytes.byteLength / CHUNK);
  for (let i = 0; i < chunks; i++) {
    const piece = Buffer.from(f.bytes.buffer, f.bytes.byteOffset + i * CHUNK, Math.min(CHUNK, f.bytes.byteLength - i * CHUNK));
    await run(`INSERT INTO file_chunks (file_id, idx, data) VALUES (?, ?, ?)`, [id, i, piece.toString('base64')]);
  }
  await run(
    `INSERT INTO resource_files (id, resource_id, filename, mime, size, chunks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, resourceId, filename, mime, f.bytes.byteLength, chunks, now()],
  );
  return (await getFile(id))!;
}

// For Claude (MCP): copies a public file onto the site.
export async function saveFileFromUrl(resourceId: string, url: string, filename?: string) {
  if (!/^https?:\/\//.test(url)) throw new UserError('The file URL must start with http:// or https://.');
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new UserError(`Could not download the file (HTTP ${res.status}).`);
  const disposition = res.headers.get('content-disposition')?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1];
  const name = filename || (disposition && decodeURIComponent(disposition)) || new URL(res.url || url).pathname.split('/').pop() || 'file';
  return saveFile(resourceId, { bytes: new Uint8Array(await res.arrayBuffer()), filename: name, mime: res.headers.get('content-type') ?? undefined });
}

export async function deleteFile(id: string) {
  await run(`DELETE FROM file_chunks WHERE file_id = ?`, [id]);
  await run(`DELETE FROM resource_files WHERE id = ?`, [id]);
}

// Streams the pieces back in order, one database read at a time.
export function fileStream(f: ResourceFile): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= f.chunks) return controller.close();
      const row = await one<{ data: string }>(`SELECT data FROM file_chunks WHERE file_id = ? AND idx = ?`, [f.id, i++]);
      if (!row) return controller.error(new Error(`Piece ${i - 1} of file ${f.id} is missing.`));
      const buf = Buffer.from(row.data, 'base64');
      controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    },
  });
}

// ---------- Views and stats ----------

export async function recordResourceView(slug: string) {
  const found = await findLiveResource(slug);
  if (!found) return;
  const day = new Date().toISOString().slice(0, 10);
  await run(
    `INSERT INTO resource_views (resource_id, day, views) VALUES (?, ?, 1)
     ON CONFLICT(resource_id, day) DO UPDATE SET views = views + 1`,
    [found.resource.id, day],
  );
}

export interface ResourceStats {
  views: number;
  unlocks: number;
  signups: number;
  downloads: number;
}

export async function resourceStats(ids: string[]): Promise<Map<string, ResourceStats>> {
  const out = new Map<string, ResourceStats>();
  const list = ids.slice(0, 90);
  if (!list.length) return out;
  const q = list.map(() => '?').join(',');
  const [views, events] = await Promise.all([
    all<{ id: string; n: number }>(`SELECT resource_id AS id, SUM(views) AS n FROM resource_views WHERE resource_id IN (${q}) GROUP BY resource_id`, list),
    all<{ id: string; unlocks: number; signups: number; downloads: number }>(
      `SELECT resource_id AS id,
         COUNT(DISTINCT CASE WHEN type = 'unlock' THEN subscriber_id END) AS unlocks,
         SUM(CASE WHEN type IN ('signup', 'resubscribe') THEN 1 ELSE 0 END) AS signups,
         SUM(CASE WHEN type = 'download' THEN 1 ELSE 0 END) AS downloads
       FROM subscriber_events WHERE resource_id IN (${q}) GROUP BY resource_id`,
      list,
    ),
  ]);
  for (const id of list) out.set(id, { views: 0, unlocks: 0, signups: 0, downloads: 0 });
  for (const v of views) out.get(v.id)!.views = Number(v.n);
  for (const e of events) Object.assign(out.get(e.id)!, { unlocks: Number(e.unlocks), signups: Number(e.signups), downloads: Number(e.downloads) });
  return out;
}

// ---------- What the page shows ----------

function linkName(url: string) {
  try {
    const u = new URL(url, 'https://x.invalid');
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'docs.google.com') {
      if (u.pathname.startsWith('/spreadsheets')) return 'Google Sheet';
      if (u.pathname.startsWith('/presentation')) return 'Google Slides';
      if (u.pathname.startsWith('/forms')) return 'Google Form';
      return 'Google Doc';
    }
    const known: Record<string, string> = {
      'drive.google.com': 'Google Drive folder',
      'notion.so': 'Notion page',
      'notion.site': 'Notion page',
      'github.com': 'GitHub repository',
      'canva.com': 'Canva template',
      'figma.com': 'Figma file',
      'airtable.com': 'Airtable base',
      'chatgpt.com': 'Custom GPT',
      'claude.ai': 'Claude project',
    };
    const hit = Object.keys(known).find((k) => host === k || host.endsWith(`.${k}`));
    return hit ? known[hit] : host === 'x.invalid' ? 'Link' : `${host} link`;
  } catch {
    return 'Link';
  }
}

// "What you get" list, shown before sign-up. Names things without giving them away.
export function inside(r: Resource, files: ResourceFile[]): string[] {
  const out: string[] = [];
  const blocks = Math.floor((r.content.match(/^\s*```/gm) ?? []).length / 2);
  if (blocks) out.push(`${blocks} copy-ready ${r.kind === 'prompt' ? 'prompt' : 'block'}${blocks > 1 ? 's' : ''}`);
  const words = plainText(r.content.replace(/```[\s\S]*?```/g, ' '), 2000).split(/\s+/).filter(Boolean).length;
  if (words > 40) out.push(blocks ? 'Notes on how to use them' : 'Step-by-step notes');
  for (const f of files) out.push(`${f.filename} (${fileSize(f.size)})`);
  if (r.linkUrl) out.push(linkName(r.linkUrl));
  return out;
}

export const linkButtonLabel = (r: Resource) => r.linkLabel || `Open the ${linkName(r.linkUrl ?? '')}`;

// ---------- Sign-up forms and cards ----------

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// The name + email form. It posts to /api/subscribe and works without JavaScript; scripts/gate.ts adds
// inline errors, typo hints and a one-click button for people who already signed up on this browser.
export function gateFormHtml(r: Pick<Resource, 'slug' | 'kind'>, page: string, button = `Get the free ${kindWord(r.kind)}`) {
  return `<form class="gate" method="post" action="/api/subscribe" data-gate data-open="${resourcePath(r.slug)}" data-word="${kindWord(r.kind)}" novalidate>
<input type="hidden" name="resource" value="${escape(r.slug)}" />
<input type="hidden" name="page" value="${escape(page)}" />
<input type="hidden" name="ts" value="${now()}" />
<div class="gate-hp" aria-hidden="true"><label>Leave this empty <input name="hp" tabindex="-1" autocomplete="off" /></label></div>
<div class="gate-fields">
<label><span class="sr">Your name</span><input name="name" required maxlength="80" autocomplete="name" placeholder="Your name" /></label>
<label><span class="sr">Your email</span><input name="email" type="email" required maxlength="254" autocomplete="email" inputmode="email" placeholder="Your email" /></label>
</div>
<p class="gate-hint" hidden></p>
<p class="gate-error" role="alert" hidden></p>
<button class="btn accent" type="submit">${escape(button)}</button>
<p class="gate-fine">${escape(emailConsent.text)} <a href="/privacy/">Privacy policy</a>.</p>
</form>`;
}

// The sign-up card inside blog posts.
export function cardHtml(r: Resource, page: string) {
  return `<aside class="res-card">
<p class="res-kicker">Free ${escape(kindWord(r.kind))}</p>
<p class="res-title"><a href="${resourcePath(r.slug)}">${escape(r.title)}</a></p>
${r.summary ? `<p class="res-sum">${escape(r.summary)}</p>` : ''}
${gateFormHtml(r, page)}
</aside>\n`;
}

// Fills in the resource markers left by renderMarkdown: a resource link on its own line becomes a sign-up
// card, and so does the resource made from a video right after that video. Each resource appears once.
export async function withResourceCards(html: string, o: { page?: string; rss?: boolean; origin?: string } = {}) {
  const explicit = [...html.matchAll(/<p data-resource="([a-z0-9-]+)">/g)].map((m) => m[1]);
  const videos = [...html.matchAll(/<!--resource:video:([\w-]{11})-->/g)].map((m) => m[1]);
  if (!explicit.length && !videos.length) return html;

  const bySlug = new Map<string, Resource>();
  for (const s of new Set(explicit)) {
    const found = await findLiveResource(s);
    if (found) bySlug.set(s, found.resource);
  }
  const byVideo = await resourcesForVideos(videos);
  const shown = new Set<string>();
  const card = (r: Resource) => {
    if (shown.has(r.id)) return '';
    shown.add(r.id);
    if (o.rss) return `<p><a href="${new URL(resourcePath(r.slug), o.origin).href}">Free ${escape(kindWord(r.kind))}: ${escape(r.title)}</a></p>\n`;
    return cardHtml(r, o.page ?? '');
  };
  return html
    .replace(/<p data-resource="([a-z0-9-]+)">([\s\S]*?)<\/p>\n?/g, (_, slug: string, inner: string) => {
      const r = bySlug.get(slug);
      return r ? card(r) : `<p>${inner}</p>\n`;
    })
    .replace(/<!--resource:video:([\w-]{11})-->\n?/g, (_, id: string) => {
      const r = byVideo.get(id);
      return r ? card(r) : '';
    });
}
