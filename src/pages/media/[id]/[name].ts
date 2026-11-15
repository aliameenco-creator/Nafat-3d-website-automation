import type { APIRoute } from 'astro';
import { getMediaBytes } from '../../../lib/server/media';

export const prerender = false;

// Images never change once uploaded (a new upload gets a new id), so they are kept for a year
// in browsers and in any CDN in front of the site.
export const GET: APIRoute = async ({ params }) => {
  const m = await getMediaBytes(params.id!);
  if (!m) return new Response('Not found', { status: 404 });
  const res = new Response(m.data, {
    headers: {
      'Content-Type': m.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      // SVGs can carry scripts; this stops them running when opened directly.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
  return res;
};
