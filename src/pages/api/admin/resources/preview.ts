import type { APIRoute } from 'astro';
import { body, guard, ok } from '../../../../lib/server/api';
import { renderMarkdown } from '../../../../lib/server/markdown';

export const prerender = false;

// Renders a resource's locked content for the editor's Preview tab, without saving.
export const POST: APIRoute = ({ request }) =>
  guard(async () => {
    const { content } = await body<{ content?: string }>(request);
    return ok({ html: renderMarkdown(String(content ?? '')) });
  });
