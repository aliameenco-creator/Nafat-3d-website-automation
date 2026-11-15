// Everything about blog posts: reading, writing, validation and the SEO checklist.
// The dashboard and the MCP server both go through these functions, so they behave the same.
import { all, newId, now, one, run, type Arg } from './db';

export type Status = 'draft' | 'published';

export interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  coverImage: string | null;
  coverAlt: string | null;
  tags: string[];
  status: Status;
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  metaTitle: string | null;
  metaDescription: string | null;
  focusKeyword: string | null;
  canonicalUrl: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  noindex: boolean;
}

// What the editor and the MCP tools may send. Every field is optional on update.
export interface PostInput {
  title?: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  coverImage?: string | null;
  coverAlt?: string | null;
  tags?: string[] | string;
  status?: Status;
  publishedAt?: number | string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  focusKeyword?: string | null;
  canonicalUrl?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImage?: string | null;
  noindex?: boolean;
}

type Row = Record<string, unknown>;

function toPost(r: Row): Post {
  return {
    id: String(r.id),
    slug: String(r.slug),
    title: String(r.title),
    excerpt: String(r.excerpt ?? ''),
    content: String(r.content ?? ''),
    coverImage: (r.cover_image as string) || null,
    coverAlt: (r.cover_alt as string) || null,
    tags: JSON.parse(String(r.tags || '[]')),
    status: r.status as Status,
    publishedAt: r.published_at == null ? null : Number(r.published_at),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    deletedAt: r.deleted_at == null ? null : Number(r.deleted_at),
    metaTitle: (r.meta_title as string) || null,
    metaDescription: (r.meta_description as string) || null,
    focusKeyword: (r.focus_keyword as string) || null,
    canonicalUrl: (r.canonical_url as string) || null,
    ogTitle: (r.og_title as string) || null,
    ogDescription: (r.og_description as string) || null,
    ogImage: (r.og_image as string) || null,
    noindex: Boolean(r.noindex),
  };
}

export const isLive = (p: Post, at = now()) =>
  p.status === 'published' && !p.deletedAt && p.publishedAt != null && p.publishedAt <= at;
export const isScheduled = (p: Post, at = now()) =>
  p.status === 'published' && !p.deletedAt && p.publishedAt != null && p.publishedAt > at;

export function postState(p: Post): 'draft' | 'scheduled' | 'published' | 'trash' {
  if (p.deletedAt) return 'trash';
  if (isScheduled(p)) return 'scheduled';
  return p.status;
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function readingMinutes(markdown: string) {
  const words = markdown.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

// Plain-text summary from Markdown, used when no excerpt or meta description is given.
export function plainText(markdown: string, max = 160) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>#|~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

// ---------- Reading ----------

export async function getPost(idOrSlug: string): Promise<Post | null> {
  const r = await one(`SELECT * FROM posts WHERE id = ? OR slug = ?`, [idOrSlug, idOrSlug]);
  return r ? toPost(r) : null;
}

export async function getLivePost(slug: string): Promise<Post | null> {
  const r = await one(
    `SELECT * FROM posts WHERE slug = ? AND status = 'published' AND deleted_at IS NULL AND published_at <= ?`,
    [slug, now()],
  );
  return r ? toPost(r) : null;
}

export async function livePosts(limit = 200): Promise<Post[]> {
  const rows = await all(
    `SELECT * FROM posts WHERE status = 'published' AND deleted_at IS NULL AND published_at <= ?
     ORDER BY published_at DESC LIMIT ?`,
    [now(), limit],
  );
  return rows.map(toPost);
}

// The newest live post that embeds or links this YouTube video.
export async function postForVideo(videoId: string): Promise<Post | null> {
  const r = await one(
    `SELECT * FROM posts WHERE status = 'published' AND deleted_at IS NULL AND published_at <= ? AND instr(content, ?) > 0
     ORDER BY published_at DESC LIMIT 1`,
    [now(), videoId],
  );
  return r ? toPost(r) : null;
}

export interface ListOptions {
  state?: 'all' | 'draft' | 'scheduled' | 'published' | 'trash';
  search?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export async function listPosts(o: ListOptions = {}): Promise<{ posts: Post[]; total: number }> {
  const where: string[] = [];
  const args: Arg[] = [];
  const t = now();
  switch (o.state ?? 'all') {
    case 'trash':
      where.push('deleted_at IS NOT NULL');
      break;
    case 'draft':
      where.push(`deleted_at IS NULL AND status = 'draft'`);
      break;
    case 'scheduled':
      where.push(`deleted_at IS NULL AND status = 'published' AND published_at > ?`);
      args.push(t);
      break;
    case 'published':
      where.push(`deleted_at IS NULL AND status = 'published' AND published_at <= ?`);
      args.push(t);
      break;
    default:
      where.push('deleted_at IS NULL');
  }
  if (o.search) {
    where.push('(title LIKE ? OR content LIKE ? OR slug LIKE ?)');
    const q = `%${o.search}%`;
    args.push(q, q, q);
  }
  if (o.tag) {
    where.push(`EXISTS (SELECT 1 FROM json_each(posts.tags) WHERE lower(value) = lower(?))`);
    args.push(o.tag);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM posts ${clause}`, args);
  const rows = await all(
    `SELECT * FROM posts ${clause} ORDER BY COALESCE(published_at, updated_at) DESC LIMIT ? OFFSET ?`,
    [...args, o.limit ?? 50, o.offset ?? 0],
  );
  return { posts: rows.map(toPost), total: Number(total?.n ?? 0) };
}

export async function postCounts() {
  const t = now();
  const r = await one<Record<string, number>>(
    `SELECT
       SUM(CASE WHEN deleted_at IS NULL AND status = 'published' AND published_at <= ? THEN 1 ELSE 0 END) AS published,
       SUM(CASE WHEN deleted_at IS NULL AND status = 'published' AND published_at > ? THEN 1 ELSE 0 END) AS scheduled,
       SUM(CASE WHEN deleted_at IS NULL AND status = 'draft' THEN 1 ELSE 0 END) AS draft,
       SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS trash
     FROM posts`,
    [t, t],
  );
  const n = (k: string) => Number(r?.[k] ?? 0);
  return { published: n('published'), scheduled: n('scheduled'), draft: n('draft'), trash: n('trash') };
}

export async function allTags(): Promise<{ tag: string; count: number }[]> {
  const rows = await all<{ tag: string; count: number }>(
    `SELECT value AS tag, COUNT(*) AS count FROM posts, json_each(posts.tags)
     WHERE deleted_at IS NULL GROUP BY lower(value) ORDER BY count DESC, tag`,
  );
  return rows.map((r) => ({ tag: String(r.tag), count: Number(r.count) }));
}

export async function relatedPosts(p: Post, limit = 3): Promise<Post[]> {
  const others = (await livePosts(60)).filter((o) => o.id !== p.id);
  const tags = new Set(p.tags.map((t) => t.toLowerCase()));
  return others
    .map((o) => ({ o, score: o.tags.filter((t) => tags.has(t.toLowerCase())).length }))
    .sort((a, b) => b.score - a.score || (b.o.publishedAt ?? 0) - (a.o.publishedAt ?? 0))
    .slice(0, limit)
    .map((x) => x.o);
}

// ---------- Writing ----------

export class PostError extends Error {}

const clean = (v: unknown, max: number) => (v == null ? null : String(v).trim().slice(0, max) || null);

export function parseTags(v: PostInput['tags']): string[] {
  const list = Array.isArray(v) ? v : String(v ?? '').split(',');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = String(raw).trim().replace(/^#/, '').slice(0, 40);
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out.slice(0, 12);
}

function parseDate(v: PostInput['publishedAt']): number | null {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? v : Date.parse(v);
  if (Number.isNaN(d)) throw new PostError(`"${v}" is not a valid date. Use ISO format, e.g. 2026-11-02T09:00:00Z.`);
  return d;
}

function checkUrl(v: string | null, field: string) {
  if (v && !/^(https?:\/\/|\/)/.test(v)) throw new PostError(`${field} must be a full URL or a path starting with /.`);
  return v;
}

async function uniqueSlug(base: string, exceptId?: string) {
  const root = slugify(base) || 'post';
  let slug = root;
  for (let i = 2; ; i++) {
    const hit = await one(`SELECT id FROM posts WHERE slug = ? AND id != ?`, [slug, exceptId ?? '']);
    if (!hit) return slug;
    slug = `${root}-${i}`;
  }
}

const COLUMNS: Record<string, string> = {
  title: 'title',
  slug: 'slug',
  excerpt: 'excerpt',
  content: 'content',
  coverImage: 'cover_image',
  coverAlt: 'cover_alt',
  tags: 'tags',
  status: 'status',
  publishedAt: 'published_at',
  metaTitle: 'meta_title',
  metaDescription: 'meta_description',
  focusKeyword: 'focus_keyword',
  canonicalUrl: 'canonical_url',
  ogTitle: 'og_title',
  ogDescription: 'og_description',
  ogImage: 'og_image',
  noindex: 'noindex',
};

// Turns raw input into column values, validating as it goes.
async function normalise(input: PostInput, existing?: Post): Promise<Record<string, Arg>> {
  const v: Record<string, Arg> = {};
  if ('title' in input) {
    const title = clean(input.title, 200);
    if (!title) throw new PostError('A post needs a title.');
    v.title = title;
  }
  if ('slug' in input || !existing) {
    const wanted = clean(input.slug, 80) ?? (v.title as string) ?? existing?.title ?? '';
    v.slug = await uniqueSlug(wanted, existing?.id);
  }
  if ('excerpt' in input) v.excerpt = clean(input.excerpt, 400) ?? '';
  if ('content' in input) v.content = String(input.content ?? '');
  if ('coverImage' in input) v.coverImage = checkUrl(clean(input.coverImage, 500), 'Cover image');
  if ('coverAlt' in input) v.coverAlt = clean(input.coverAlt, 200);
  if ('tags' in input) v.tags = JSON.stringify(parseTags(input.tags));
  if ('status' in input) {
    if (input.status !== 'draft' && input.status !== 'published') throw new PostError('Status must be draft or published.');
    v.status = input.status;
  }
  if ('publishedAt' in input) v.publishedAt = parseDate(input.publishedAt);
  // Publishing without a date means "now". Going back to draft keeps the date for later.
  const status = (v.status as Status | undefined) ?? existing?.status ?? 'draft';
  const date = 'publishedAt' in v ? v.publishedAt : existing?.publishedAt;
  if (status === 'published' && date == null) v.publishedAt = now();
  if ('metaTitle' in input) v.metaTitle = clean(input.metaTitle, 120);
  if ('metaDescription' in input) v.metaDescription = clean(input.metaDescription, 320);
  if ('focusKeyword' in input) v.focusKeyword = clean(input.focusKeyword, 80);
  if ('canonicalUrl' in input) v.canonicalUrl = checkUrl(clean(input.canonicalUrl, 500), 'Canonical URL');
  if ('ogTitle' in input) v.ogTitle = clean(input.ogTitle, 120);
  if ('ogDescription' in input) v.ogDescription = clean(input.ogDescription, 320);
  if ('ogImage' in input) v.ogImage = checkUrl(clean(input.ogImage, 500), 'Social image');
  if ('noindex' in input) v.noindex = input.noindex ? 1 : 0;
  return v;
}

export async function createPost(input: PostInput, authorId?: string): Promise<Post> {
  if (!clean(input.title, 200)) throw new PostError('A post needs a title.');
  const v = await normalise({ status: 'draft', ...input });
  const id = newId();
  const t = now();
  const cols = Object.keys(v).map((k) => COLUMNS[k]);
  await run(
    `INSERT INTO posts (id, created_at, updated_at, author_id, ${cols.join(', ')})
     VALUES (?, ?, ?, ?, ${cols.map(() => '?').join(', ')})`,
    [id, t, t, authorId ?? null, ...Object.values(v)],
  );
  return (await getPost(id))!;
}

export async function updatePost(idOrSlug: string, input: PostInput): Promise<Post> {
  const existing = await getPost(idOrSlug);
  if (!existing) throw new PostError(`No post found for "${idOrSlug}".`);
  const v = await normalise(input, existing);
  const keys = Object.keys(v);
  if (keys.length) {
    await run(
      `UPDATE posts SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      [...Object.values(v), now(), existing.id],
    );
  }
  return (await getPost(existing.id))!;
}

export async function trashPost(idOrSlug: string) {
  const p = await getPost(idOrSlug);
  if (!p) throw new PostError(`No post found for "${idOrSlug}".`);
  await run(`UPDATE posts SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), p.id]);
  return p;
}

export async function restorePost(idOrSlug: string) {
  const p = await getPost(idOrSlug);
  if (!p) throw new PostError(`No post found for "${idOrSlug}".`);
  await run(`UPDATE posts SET deleted_at = NULL, updated_at = ? WHERE id = ?`, [now(), p.id]);
  return p;
}

export async function destroyPost(idOrSlug: string) {
  const p = await getPost(idOrSlug);
  if (!p) throw new PostError(`No post found for "${idOrSlug}".`);
  if (!p.deletedAt) throw new PostError('Move the post to the trash before deleting it for good.');
  await run(`DELETE FROM posts WHERE id = ?`, [p.id]);
  await run(`DELETE FROM post_views WHERE post_id = ?`, [p.id]);
}

export async function duplicatePost(idOrSlug: string, authorId?: string) {
  const p = await getPost(idOrSlug);
  if (!p) throw new PostError(`No post found for "${idOrSlug}".`);
  const { id: _i, slug: _s, createdAt: _c, updatedAt: _u, deletedAt: _d, publishedAt: _p, status: _st, ...rest } = p;
  return createPost({ ...rest, title: `${p.title} (copy)`, status: 'draft' }, authorId);
}

// ---------- Views ----------

export async function recordView(slug: string) {
  const p = await getLivePost(slug);
  if (!p) return;
  const day = new Date().toISOString().slice(0, 10);
  await run(
    `INSERT INTO post_views (post_id, day, views) VALUES (?, ?, 1)
     ON CONFLICT(post_id, day) DO UPDATE SET views = views + 1`,
    [p.id, day],
  );
}

export async function viewsByDay(days = 30) {
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await all<{ day: string; views: number }>(
    `SELECT day, SUM(views) AS views FROM post_views WHERE day >= ? GROUP BY day`,
    [since],
  );
  const map = new Map(rows.map((r) => [String(r.day), Number(r.views)]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, views: map.get(day) ?? 0 };
  });
}

export async function topPosts(days = 30, limit = 5) {
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await all<{ id: string; title: string; slug: string; views: number }>(
    `SELECT p.id, p.title, p.slug, SUM(v.views) AS views FROM post_views v JOIN posts p ON p.id = v.post_id
     WHERE v.day >= ? AND p.deleted_at IS NULL GROUP BY p.id ORDER BY views DESC LIMIT ?`,
    [since, limit],
  );
  return rows.map((r) => ({ ...r, views: Number(r.views) }));
}

export async function viewTotals(ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await all<{ post_id: string; views: number }>(
    `SELECT post_id, SUM(views) AS views FROM post_views WHERE post_id IN (${ids.map(() => '?').join(',')}) GROUP BY post_id`,
    ids,
  );
  return new Map(rows.map((r) => [String(r.post_id), Number(r.views)]));
}

// ---------- SEO ----------

export interface SeoCheck {
  label: string;
  ok: boolean;
  tip?: string;
  weight: number;
}

// The same checklist powers the editor sidebar and the MCP `seo_audit` tool.
export function seoAudit(p: Pick<Post, 'title' | 'slug' | 'content' | 'excerpt' | 'coverImage' | 'coverAlt' | 'tags' | 'metaTitle' | 'metaDescription' | 'focusKeyword' | 'ogImage' | 'noindex'>) {
  const title = p.metaTitle || p.title;
  const description = p.metaDescription || p.excerpt;
  const kw = (p.focusKeyword || '').toLowerCase().trim();
  const body = p.content.toLowerCase();
  const words = p.content.split(/\s+/).filter(Boolean).length;
  const firstPara = plainText(p.content, 400).toLowerCase().slice(0, 300);
  const headings = (p.content.match(/^#{2,3}\s.+$/gm) ?? []).length;
  const links = (p.content.match(/\]\((?!https?:\/\/)[^)]+\)/g) ?? []).length + (p.content.match(/\]\(https?:\/\/[^)]+\)/g) ?? []).length;
  const images = p.content.match(/!\[([^\]]*)\]\([^)]+\)/g) ?? [];
  const imagesWithoutAlt = images.filter((m) => /^!\[\s*\]/.test(m)).length;
  const kwCount = kw ? body.split(kw).length - 1 : 0;

  const checks: SeoCheck[] = [
    { label: 'Meta title is 30–60 characters', ok: title.length >= 30 && title.length <= 60, weight: 15, tip: `Currently ${title.length}. Google cuts titles off around 60.` },
    { label: 'Meta description is 120–160 characters', ok: description.length >= 120 && description.length <= 160, weight: 15, tip: `Currently ${description.length}. This is the grey text under your title in search results.` },
    { label: 'Focus keyword is set', ok: Boolean(kw), weight: 5, tip: 'Pick the one phrase you want this post to rank for.' },
    { label: 'Keyword appears in the title', ok: !kw || title.toLowerCase().includes(kw), weight: 10 },
    { label: 'Keyword appears in the meta description', ok: !kw || description.toLowerCase().includes(kw), weight: 5 },
    { label: 'Keyword appears in the first paragraph', ok: !kw || firstPara.includes(kw), weight: 5 },
    { label: 'Keyword appears in the URL', ok: !kw || p.slug.includes(slugify(kw)), weight: 5 },
    { label: 'Keyword is used 2+ times in the body', ok: !kw || kwCount >= 2, weight: 5, tip: kw ? `Used ${kwCount} time(s).` : undefined },
    { label: 'At least 600 words', ok: words >= 600, weight: 10, tip: `Currently ${words} words.` },
    { label: 'Uses subheadings (## or ###)', ok: headings >= 2, weight: 5, tip: 'Break long posts into sections so they are easy to scan.' },
    { label: 'Has at least one link', ok: links - images.length > 0, weight: 5, tip: 'Link to one of your other posts or a useful source.' },
    { label: 'Has a cover or social image', ok: Boolean(p.coverImage || p.ogImage), weight: 10, tip: 'Posts with an image get far more clicks when shared.' },
    { label: 'Images have alt text', ok: imagesWithoutAlt === 0 && (!p.coverImage || Boolean(p.coverAlt)), weight: 5 },
    { label: 'URL is short and readable', ok: p.slug.length <= 60 && p.slug.split('-').length <= 8, weight: 5 },
    { label: 'Has tags', ok: p.tags.length > 0, weight: 3 },
    { label: 'Search engines may index it', ok: !p.noindex, weight: 2, tip: '"Hide from search engines" is switched on.' },
  ];
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const score = Math.round((checks.filter((c) => c.ok).reduce((s, c) => s + c.weight, 0) / total) * 100);
  return { score, checks };
}
