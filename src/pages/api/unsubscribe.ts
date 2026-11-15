import type { APIRoute } from 'astro';
import { subscriberFromUnsubToken, unsubscribe, visitorFrom } from '../../lib/server/subscribers';

export const prerender = false;

// One-click unsubscribe (RFC 8058): Gmail, Yahoo and others call this from their own "Unsubscribe" button,
// using the List-Unsubscribe header in every email.
export const POST: APIRoute = async (ctx) => {
  const s = await subscriberFromUnsubToken(ctx.url.searchParams.get('t'));
  if (s) await unsubscribe(s.id, visitorFrom(ctx.request, () => ctx.clientAddress), 'One-click unsubscribe from their email app');
  return new Response(s ? 'Unsubscribed' : 'Link not valid', { status: s ? 200 : 404, headers: { 'Cache-Control': 'no-store' } });
};

// Someone opening the header link in a browser gets the normal page with a button.
export const GET: APIRoute = ({ url, redirect }) => redirect(`/unsubscribe/?t=${encodeURIComponent(url.searchParams.get('t') ?? '')}`, 303);
