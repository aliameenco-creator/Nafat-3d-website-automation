// Signed subscriber ids for the "remember me" cookie and the links in emails (open a resource, unsubscribe).
// HMAC-SHA256 with a random key that is created once and kept in the database, so links cannot be forged
// and no token table is needed.
import { one, run } from './db';

let key: CryptoKey | undefined;

async function hmacKey() {
  if (key) return key;
  let row = await one<{ value: string }>(`SELECT value FROM meta WHERE key = 'link_secret'`);
  if (!row) {
    const fresh = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    // Two first requests may race here; OR IGNORE keeps whichever key was stored first.
    await run(`INSERT OR IGNORE INTO meta (key, value) VALUES ('link_secret', ?)`, [fresh]);
    row = await one<{ value: string }>(`SELECT value FROM meta WHERE key = 'link_secret'`);
  }
  const raw = Uint8Array.from(atob(row!.value), (c) => c.charCodeAt(0));
  key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return key;
}

const b64url = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

export type Purpose = 'access' | 'unsub';

export async function sign(purpose: Purpose, id: string) {
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(`${purpose}:${id}`));
  return `${id}.${b64url(mac).slice(0, 32)}`;
}

// Returns the subscriber id the token was made for, or null.
export async function verify(purpose: Purpose, token: string | null | undefined) {
  const [id, mac = ''] = String(token ?? '').split('.');
  if (!/^[a-f0-9]{16}$/.test(id ?? '')) return null;
  const want = (await sign(purpose, id)).split('.')[1];
  // Compares every character so timing reveals nothing.
  let diff = want.length ^ mac.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (mac.charCodeAt(i) || 0);
  return diff === 0 ? id : null;
}
