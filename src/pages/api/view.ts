import type { APIRoute } from 'astro';
import { recordView } from '../../lib/server/posts';
import { recordResourceView } from '../../lib/server/resources';

export const prerender = false;

const BOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse/i;

// Counts one view per page load from the reader's browser, which skips most bots and link previews.
// The body is a post slug, or "r:<slug>" for a free resource.
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.text()).trim().slice(0, 110);
    if (body && !BOTS.test(request.headers.get('user-agent') ?? '')) {
      if (body.startsWith('r:')) await recordResourceView(body.slice(2));
      else await recordView(body);
    }
  } catch {}
  return new Response(null, { status: 204 });
};
