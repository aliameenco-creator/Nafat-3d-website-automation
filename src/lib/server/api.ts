// Small helpers shared by the /api/admin endpoints.
import { MediaError } from './media';
import { PostError } from './posts';

export const ok = (data: unknown = { ok: true }, status = 200) => Response.json(data, { status });
export const fail = (error: string, status = 400) => Response.json({ error }, { status });

// A problem the person can fix (bad input, too many tries…). `code` names it for pages that work without JavaScript.
export class UserError extends Error {
  constructor(message: string, public status = 400, public code = 'invalid') {
    super(message);
  }
}

// Expected problems (bad input) become a 400 with the message; anything else is a 500.
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UserError) return fail(e.message, e.status);
    if (e instanceof PostError || e instanceof MediaError) return fail(e.message);
    console.error(e);
    return fail('Something went wrong on the server. Check the logs.', 500);
  }
}

export async function body<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new PostError('The request body must be JSON.');
  }
}
