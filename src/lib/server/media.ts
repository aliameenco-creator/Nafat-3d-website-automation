// Images live in the SQLite database and are served from /media/<id>/<name>, cached in browsers (and by the
// Hostinger CDN) for a year, so the blog needs no separate file storage service.
import { all, newId, now, one, run } from './db';

// The dashboard shrinks photos to WebP before upload, so this limit rarely bites.
export const MAX_BYTES = 1.9 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml']);

export interface Media {
  id: string;
  filename: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string;
  created_at: number;
  url: string;
}

export class MediaError extends Error {}

const safeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-80) || 'image';

export const mediaUrl = (id: string, filename: string) => `/media/${id}/${filename}`;

export async function saveMedia(o: {
  bytes: Uint8Array;
  mime: string;
  filename: string;
  alt?: string;
  width?: number | null;
  height?: number | null;
}): Promise<Media> {
  const mime = o.mime.split(';')[0].trim().toLowerCase();
  if (!TYPES.has(mime)) throw new MediaError(`Unsupported image type ${mime}. Use JPG, PNG, WebP, GIF, AVIF or SVG.`);
  if (o.bytes.byteLength > MAX_BYTES) throw new MediaError('Images must be under 1.9 MB. Resize it or save it as WebP/JPG.');
  if (!o.bytes.byteLength) throw new MediaError('The image is empty.');
  const id = newId();
  const filename = safeName(o.filename);
  await run(
    `INSERT INTO media (id, filename, mime, size, width, height, alt, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, filename, mime, o.bytes.byteLength, o.width ?? null, o.height ?? null, (o.alt ?? '').slice(0, 200), o.bytes, now()],
  );
  return (await getMedia(id))!;
}

// Recognises the image type from the first bytes, for servers that send a generic content type.
function sniff(b: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(4, 12) === 'ftypavif') return 'image/avif';
  if (/<svg[\s>]/i.test(ascii(0, 200))) return 'image/svg+xml';
  return null;
}

export async function saveMediaFromUrl(url: string, alt?: string, _siteOrigin?: string): Promise<Media> {
  if (!/^https?:\/\//.test(url)) throw new MediaError('The image URL must start with http:// or https://.');
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new MediaError(`Could not download the image (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const name = new URL(res.url || url).pathname.split('/').pop() || 'image';
  const header = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const mime = header.startsWith('image/') ? header : (sniff(bytes) ?? header);
  return saveMedia({ bytes, mime, filename: name, alt });
}

function toMedia(r: Record<string, unknown>): Media {
  return {
    id: String(r.id),
    filename: String(r.filename),
    mime: String(r.mime),
    size: Number(r.size),
    width: r.width == null ? null : Number(r.width),
    height: r.height == null ? null : Number(r.height),
    alt: String(r.alt ?? ''),
    created_at: Number(r.created_at),
    url: mediaUrl(String(r.id), String(r.filename)),
  };
}

export async function getMedia(id: string) {
  const r = await one(`SELECT id, filename, mime, size, width, height, alt, created_at FROM media WHERE id = ?`, [id]);
  return r ? toMedia(r) : null;
}

export async function getMediaBytes(id: string) {
  const row = await one<{ data: ArrayBuffer | number[]; mime: string }>(`SELECT data, mime FROM media WHERE id = ?`, [id]);
  return row && { mime: row.mime, data: new Uint8Array(row.data as ArrayLike<number>) };
}

export async function listMedia(limit = 200) {
  const rows = await all(
    `SELECT id, filename, mime, size, width, height, alt, created_at FROM media ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(toMedia);
}

export async function updateMediaAlt(id: string, alt: string) {
  await run(`UPDATE media SET alt = ? WHERE id = ?`, [alt.slice(0, 200), id]);
}

export async function deleteMedia(id: string) {
  await run(`DELETE FROM media WHERE id = ?`, [id]);
}
