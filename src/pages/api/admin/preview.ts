import type { APIRoute } from 'astro';
import { body, guard, ok } from '../../../lib/server/api';
import { renderMarkdown } from '../../../lib/server/markdown';
import { readingMinutes, seoAudit, type Post } from '../../../lib/server/posts';
import { withResourceCards } from '../../../lib/server/resources';

export const prerender = false;

// Renders the editor's Markdown and scores its SEO without saving anything.
export const POST: APIRoute = ({ request }) =>
  guard(async () => {
    const p = await body<Post>(request);
    const content = String(p.content ?? '');
    return ok({
      html: await withResourceCards(renderMarkdown(content)),
      minutes: readingMinutes(content),
      words: content.split(/\s+/).filter(Boolean).length,
      seo: seoAudit({ ...p, content, tags: Array.isArray(p.tags) ? p.tags : [] }),
    });
  });
