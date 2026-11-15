import type { APIRoute } from 'astro';
import { body, guard, ok } from '../../../../lib/server/api';
import { createPost, type PostInput } from '../../../../lib/server/posts';

export const prerender = false;

export const POST: APIRoute = ({ request, locals }) =>
  guard(async () => {
    const post = await createPost(await body<PostInput>(request), locals.user!.id);
    return ok({ post }, 201);
  });
