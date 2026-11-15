import { siteOrigin } from '../lib/origin';
import type { APIRoute } from 'astro';
import { livePosts } from '../lib/server/posts';
import { coverOf, liveResources, resourcePath } from '../lib/server/resources';

export const prerender = false;

// The homepage, blog posts and free resources. Posts and resources change without a rebuild, so this is built per request.
export const GET: APIRoute = async ({ url: req }) => {
  const base = siteOrigin(req);
  const posts = (await livePosts(5000)).filter((p) => !p.noindex && !p.canonicalUrl);
  const resources = await liveResources({ limit: 5000 });
  const tags = [...new Set(posts.flatMap((p) => p.tags.map((t) => t.toLowerCase())))];
  const newest = posts[0] ? new Date(Math.max(...posts.map((p) => p.updatedAt))).toISOString() : undefined;
  const url = (loc: string, lastmod?: string, image?: string | null) =>
    `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${
      image ? `<image:image><image:loc>${new URL(image, base).href}</image:loc></image:image>` : ''
    }</url>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${url(`${base}/`)}
${url(`${base}/blog/`, newest)}
${posts.map((p) => url(`${base}/blog/${p.slug}/`, new Date(p.updatedAt).toISOString(), p.coverImage)).join('\n')}
${tags.map((t) => url(`${base}/blog/tag/${encodeURIComponent(t)}/`)).join('\n')}
${resources.length ? url(`${base}/resources/`, new Date(Math.max(...resources.map((r) => r.updatedAt))).toISOString()) : ''}
${resources.map((r) => url(`${base}${resourcePath(r.slug)}`, new Date(r.updatedAt).toISOString(), coverOf(r))).join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
};
