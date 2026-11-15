import type { APIRoute } from 'astro';
import { findLiveResource, resourcePath } from '../../lib/server/resources';

export const prerender = false;

// The short link for YouTube descriptions: /r/<slug>. It follows the resource when its slug changes, and an
// unknown slug lands on search instead of an error page.
export const GET: APIRoute = async ({ params, redirect }) => {
  const slug = params.slug ?? '';
  const found = await findLiveResource(slug);
  if (found) return redirect(resourcePath(found.resource.slug), 302);
  return redirect(`/search/?q=${encodeURIComponent(slug.replace(/-/g, ' '))}`, 302);
};
