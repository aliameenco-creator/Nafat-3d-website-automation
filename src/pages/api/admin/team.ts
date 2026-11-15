import type { APIRoute } from 'astro';
import { body, fail, guard, ok } from '../../../lib/server/api';
import { createUser, passwordProblem } from '../../../lib/server/auth';
import { one, run } from '../../../lib/server/db';

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  guard(async () => {
    const { email, name, password } = await body<{ email: string; name: string; password: string }>(request);
    const e = String(email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return fail('Enter a valid email address.');
    const problem = passwordProblem(String(password ?? ''));
    if (problem) return fail(problem);
    if (await one(`SELECT id FROM users WHERE email = ?`, [e])) return fail('That email is already an admin.');
    await createUser(e, String(name ?? ''), String(password));
    return ok({ ok: true }, 201);
  });

export const DELETE: APIRoute = ({ url, locals }) =>
  guard(async () => {
    const id = url.searchParams.get('id') ?? '';
    if (id === locals.user!.id) return fail('You cannot remove yourself.');
    await run(`DELETE FROM sessions WHERE user_id = ?`, [id]);
    await run(`DELETE FROM api_tokens WHERE user_id = ?`, [id]);
    await run(`DELETE FROM users WHERE id = ?`, [id]);
    return ok();
  });
