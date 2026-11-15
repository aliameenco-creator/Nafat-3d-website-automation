import { siteOrigin } from '../lib/origin';
import type { APIRoute } from 'astro';
import { site } from '../data/site';
import { renderMarkdown } from '../lib/server/markdown';
import { livePosts, plainText } from '../lib/server/posts';
import { withResourceCards } from '../lib/server/resources';

export const prerender = false;

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

export const GET: APIRoute = async ({ url: req }) => {
  const base = siteOrigin(req);
  const posts = (await livePosts(50)).filter((p) => !p.noindex);
  const bodies = await Promise.all(posts.map((p) => withResourceCards(renderMarkdown(p.content), { rss: true, origin: base })));
  const items = posts
    .map((p, i) => {
      const url = `${base}/blog/${p.slug}/`;
      const cover = p.coverImage ? `<img src="${esc(new URL(p.coverImage, base).href)}" alt="${esc(p.coverAlt ?? '')}" />` : '';
      return `<item>
<title>${esc(p.title)}</title>
<link>${url}</link>
<guid isPermaLink="true">${url}</guid>
<pubDate>${new Date(p.publishedAt!).toUTCString()}</pubDate>
<description>${esc(p.metaDescription || p.excerpt || plainText(p.content))}</description>
${p.tags.map((t) => `<category>${esc(t)}</category>`).join('')}
<content:encoded>${cdata(cover + bodies[i])}</content:encoded>
</item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>${esc(site.name)} — Blog</title>
<link>${base}/blog/</link>
<description>${esc(site.description)}</description>
<language>en</language>
<atom:link href="${base}/rss.xml" rel="self" type="application/rss+xml" />
${posts[0] ? `<lastBuildDate>${new Date(Math.max(...posts.map((p) => p.updatedAt))).toUTCString()}</lastBuildDate>` : ''}
${items}
</channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
};
