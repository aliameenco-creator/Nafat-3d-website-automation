// Passwords (PBKDF2-SHA256 via Web Crypto, built into Node), sessions
// (random token, only its hash is stored), login rate limiting and API tokens for the MCP server.
import type { AstroCookies } from 'astro';
import { getSecret } from 'astro:env/server';
import { site } from '../../data/site';
import { all, newId, now, one, run } from './db';

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: number;
  last_login_at: number | null;
}

export const SESSION_COOKIE = 'sid';
const DAY = 86_400_000;
const LONG_SESSION = 30 * DAY;
const SHORT_SESSION = DAY / 2;
const MAX_FAILS = 5;
const FAIL_WINDOW = 15 * 60_000;
// 100k iterations (kept so password hashes made elsewhere still work).
const ITERATIONS = 100_000;

const enc = new TextEncoder();
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => new Uint8Array(Array.from(atob(s), (c) => c.charCodeAt(0)));
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
const token = (bytes = 32) => toB64(randomBytes(bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

async function sha256(s: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

// Compares without stopping at the first difference, so timing reveals nothing.
function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(key)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split('$');
  if (algo !== 'pbkdf2' || !salt || !hash) return false;
  const key = await pbkdf2(password, fromB64(salt), Number(iter));
  return equal(key, fromB64(hash));
}

// The dashboard lives at /<ADMIN_PATH>/ rather than /admin, so its sign-in page cannot be found by guessing.
// ADMIN_PATH is an environment variable set in Hostinger (see README). Without it the dashboard stays at /admin.
export function adminBase() {
  const slug = (getSecret('ADMIN_PATH') ?? '').trim().replace(/^\/+|\/+$/g, '');
  return `/${/^[\w-]{1,100}$/.test(slug) ? slug : 'admin'}`;
}

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'That password is too long.';
  return null;
}

// ---------- Sign in ----------

async function recentFails(key: string) {
  const row = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at > ?`, [
    key,
    now() - FAIL_WINDOW,
  ]);
  return Number(row?.n ?? 0);
}

export type SignInResult = { ok: true; user: User } | { ok: false; error: string };

export async function signIn(email: string, password: string, ip: string): Promise<SignInResult> {
  email = email.trim().toLowerCase();
  const keys = [`ip:${ip}`, `email:${email}`];
  for (const k of keys) {
    if ((await recentFails(k)) >= MAX_FAILS) {
      return { ok: false, error: 'Too many attempts. Wait 15 minutes and try again.' };
    }
  }

  await bootstrapFirstAdmin();
  const row = await one<User & { password_hash: string }>(`SELECT * FROM users WHERE email = ?`, [email]);
  // Hash even when the user does not exist so timing does not reveal which emails are admins.
  const valid = row
    ? await verifyPassword(password, row.password_hash)
    : (await verifyPassword(password, `pbkdf2$${ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$${'A'.repeat(43)}=`), false);

  if (!row || !valid) {
    const t = now();
    for (const k of keys) await run(`INSERT INTO login_attempts (key, at) VALUES (?, ?)`, [k, t]);
    await run(`DELETE FROM login_attempts WHERE at < ?`, [t - FAIL_WINDOW]);
    return { ok: false, error: 'That email and password do not match.' };
  }

  await run(`DELETE FROM login_attempts WHERE key IN (?, ?)`, keys);
  await run(`UPDATE users SET last_login_at = ? WHERE id = ?`, [now(), row.id]);
  const { password_hash: _, ...user } = row;
  return { ok: true, user };
}

// The very first admin comes from ADMIN_EMAIL and ADMIN_PASSWORD. Once any admin exists these are ignored.
async function bootstrapFirstAdmin() {
  const count = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM users`);
  if (Number(count?.n) > 0) return;
  const email = getSecret('ADMIN_EMAIL')?.trim().toLowerCase();
  const password = getSecret('ADMIN_PASSWORD');
  if (!email || !password) return;
  await createUser(email, site.name, password);
}

export async function hasAnyAdmin() {
  const count = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM users`);
  return Number(count?.n) > 0 || Boolean(getSecret('ADMIN_EMAIL') && getSecret('ADMIN_PASSWORD'));
}

export async function createUser(email: string, name: string, password: string) {
  const id = newId();
  await run(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`, [
    id,
    email.trim().toLowerCase(),
    name.trim() || email,
    await hashPassword(password),
    now(),
  ]);
  return id;
}

// ---------- Sessions ----------

export async function startSession(cookies: AstroCookies, userId: string, remember: boolean, userAgent: string) {
  const raw = token();
  const ttl = remember ? LONG_SESSION : SHORT_SESSION;
  await run(`INSERT INTO sessions (id, user_id, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?)`, [
    await sha256(raw),
    userId,
    now() + ttl,
    now(),
    userAgent.slice(0, 200),
  ]);
  cookies.set(SESSION_COOKIE, raw, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
    maxAge: remember ? ttl / 1000 : undefined,
  });
}

export async function userFromSession(cookies: AstroCookies): Promise<User | null> {
  const raw = cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const row = await one<User & { expires_at: number; sid: string }>(
    `SELECT u.id, u.email, u.name, u.created_at, u.last_login_at, s.expires_at, s.id AS sid
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    [await sha256(raw)],
  );
  if (!row || row.expires_at < now()) return null;
  const { expires_at: _e, sid: _s, ...user } = row;
  return user;
}

export async function endSession(cookies: AstroCookies) {
  const raw = cookies.get(SESSION_COOKIE)?.value;
  if (raw) await run(`DELETE FROM sessions WHERE id = ?`, [await sha256(raw)]);
  cookies.delete(SESSION_COOKIE, { path: '/' });
  await run(`DELETE FROM sessions WHERE expires_at < ?`, [now()]);
}

export async function endOtherSessions(cookies: AstroCookies, userId: string) {
  const raw = cookies.get(SESSION_COOKIE)?.value ?? '';
  await run(`DELETE FROM sessions WHERE user_id = ? AND id != ?`, [userId, await sha256(raw)]);
}

// ---------- API tokens (MCP) ----------

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
}

export async function createApiToken(userId: string, name: string) {
  const raw = `blog_${token(24)}`;
  await run(`INSERT INTO api_tokens (id, name, token_hash, prefix, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [
    newId(),
    name.trim().slice(0, 60) || 'Claude',
    await sha256(raw),
    raw.slice(0, 9),
    userId,
    now(),
  ]);
  return raw;
}

export async function listApiTokens() {
  return all<ApiToken>(`SELECT id, name, prefix, created_at, last_used_at FROM api_tokens ORDER BY created_at DESC`);
}

export async function userFromApiToken(header: string | null): Promise<User | null> {
  const raw = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!raw) return null;
  const row = await one<User & { tid: string }>(
    `SELECT u.id, u.email, u.name, u.created_at, u.last_login_at, t.id AS tid
     FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`,
    [await sha256(raw)],
  );
  if (!row) return null;
  await run(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`, [now(), row.tid]);
  const { tid: _, ...user } = row;
  return user;
}
