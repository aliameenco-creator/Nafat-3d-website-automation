// Thin wrapper over SQLite, using the sqlite module built into Node 22.13+ (no native add-ons to compile,
// which matters on shared hosting). The whole database is ONE file, set by DB_PATH (default ./data/nafay.sqlite).
// On Hostinger put it OUTSIDE the app folder (e.g. /home/<user>/nafay-data/nafay.sqlite) so redeploys never touch it.
// The functions stay async so the modules that call them did not have to change.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export type Arg = string | number | null | ArrayBuffer | Uint8Array;

let conn: DatabaseSync | undefined;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    user_agent TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT NOT NULL,
    at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS login_attempts_key ON login_attempts(key, at)`,
  `CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    excerpt TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    cover_image TEXT,
    cover_alt TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    published_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    author_id TEXT,
    meta_title TEXT,
    meta_description TEXT,
    focus_keyword TEXT,
    canonical_url TEXT,
    og_title TEXT,
    og_description TEXT,
    og_image TEXT,
    noindex INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS posts_live ON posts(status, published_at)`,
  `CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    alt TEXT NOT NULL DEFAULT '',
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS post_views (
    post_id TEXT NOT NULL,
    day TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (post_id, day)
  )`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,

  // Free resources (prompts, templates, links, files). `content`, `link_url` and the files are only shown
  // after a visitor gives their name and email. `old_slugs` keeps links in old YouTube descriptions working.
  `CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    old_slugs TEXT NOT NULL DEFAULT '[]',
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'prompt',
    summary TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    link_url TEXT,
    link_label TEXT,
    video_id TEXT,
    video_title TEXT,
    cover_image TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    keywords TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    published_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS resources_video ON resources(video_id)`,
  `CREATE TABLE IF NOT EXISTS resource_files (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    chunks INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS resource_files_resource ON resource_files(resource_id)`,
  // Files are split into base64 pieces because D1 stores at most 2 MB per value.
  `CREATE TABLE IF NOT EXISTS file_chunks (
    file_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (file_id, idx)
  )`,
  `CREATE TABLE IF NOT EXISTS resource_views (
    resource_id TEXT NOT NULL,
    day TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (resource_id, day)
  )`,

  // The email list. One row per address; everything a person does is in subscriber_events, which doubles as
  // the record of consent (when, from which page, which IP, and the exact wording they agreed to).
  `CREATE TABLE IF NOT EXISTS subscribers (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'subscribed',
    source TEXT,
    source_page TEXT,
    consent TEXT,
    ip TEXT,
    country TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    confirmed_at INTEGER,
    confirm_ip TEXT,
    unsubscribed_at INTEGER,
    last_seen_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS subscribers_created ON subscribers(created_at)`,
  `CREATE TABLE IF NOT EXISTS subscriber_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id TEXT NOT NULL,
    type TEXT NOT NULL,
    resource_id TEXT,
    detail TEXT,
    page TEXT,
    ip TEXT,
    country TEXT,
    user_agent TEXT,
    at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS subscriber_events_sub ON subscriber_events(subscriber_id, at)`,
  `CREATE INDEX IF NOT EXISTS subscriber_events_res ON subscriber_events(resource_id, type)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS rate_limits_key ON rate_limits(key, at)`,

  // Emails sent to the list from the dashboard. Recipients are fixed when sending starts, so a broadcast
  // can be paused and resumed without anyone getting it twice.
  `CREATE TABLE IF NOT EXISTS broadcasts (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL DEFAULT '',
    preheader TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    audience TEXT NOT NULL DEFAULT 'all',
    status TEXT NOT NULL DEFAULT 'draft',
    total INTEGER NOT NULL DEFAULT 0,
    sent INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS broadcast_recipients (
    broadcast_id TEXT NOT NULL,
    subscriber_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    claimed_at INTEGER,
    sent_at INTEGER,
    PRIMARY KEY (broadcast_id, subscriber_id)
  )`,
  `CREATE INDEX IF NOT EXISTS broadcast_recipients_status ON broadcast_recipients(broadcast_id, status)`,
];

function open(): DatabaseSync {
  if (conn) return conn;
  const file = resolve(process.env.DB_PATH || './data/nafay.sqlite');
  mkdirSync(dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  for (const s of SCHEMA) d.exec(s);
  conn = d;
  return d;
}

const clean = (args: Arg[]) => args.map((a) => (a === undefined ? null : a instanceof ArrayBuffer ? new Uint8Array(a) : a)) as any[];

export async function all<T = Record<string, unknown>>(sql: string, args: Arg[] = []): Promise<T[]> {
  return open().prepare(sql).all(...clean(args)) as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, args: Arg[] = []): Promise<T | undefined> {
  return (await all<T>(sql, args))[0];
}

// `meta.changes` and `meta.last_row_id` keep the shape the old D1 wrapper returned.
export async function run(sql: string, args: Arg[] = []) {
  const r = open().prepare(sql).run(...clean(args));
  return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
}

// Several writes applied together, or not at all.
export async function batch(statements: { sql: string; args: Arg[] }[]) {
  if (!statements.length) return;
  const d = open();
  d.exec('BEGIN');
  try {
    for (const s of statements) d.prepare(s.sql).run(...clean(s.args));
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => Date.now();
export const newId = () => randomUUID().replace(/-/g, '').slice(0, 16);
