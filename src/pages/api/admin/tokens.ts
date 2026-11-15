import type { APIRoute } from 'astro';
import { body, guard, ok } from '../../../lib/server/api';
import { createApiToken } from '../../../lib/server/auth';
import { run } from '../../../lib/server/db';

export const prerender = false;

// The raw token is returned once and never stored.
export const POST: APIRoute = ({ request, locals }) =>
  guard(async () => {
    const { name } = await body<{ name: string }>(request);
    return ok({ token: await createApiToken(locals.user!.id, String(name ?? '')) }, 201);
  });

export const DELETE: APIRoute = ({ url }) =>
  guard(async () => {
    await run(`DELETE FROM api_tokens WHERE id = ?`, [url.searchParams.get('id') ?? '']);
    return ok();
  });
