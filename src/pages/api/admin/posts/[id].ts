import type { APIRoute } from 'astro';
import { body, fail, guard, ok } from '../../../../lib/server/api';
import {
  destroyPost,
  duplicatePost,
  getPost,
  restorePost,
  trashPost,
  updatePost,
  type PostInput,
} from '../../../../lib/server/posts';

export const prerender = false;

export const GET: APIRoute = ({ params }) =>
  guard(async () => {
    const post = await getPost(params.id!);
    return post ? ok({ post }) : fail('Not found', 404);
  });

export const PATCH: APIRoute = ({ params, request }) =>
  guard(async () => ok({ post: await updatePost(params.id!, await body<PostInput>(request)) }));

// Trash by default; ?forever=1 deletes a post that is already in the trash.
export const DELETE: APIRoute = ({ params, url }) =>
  guard(async () => {
    if (url.searchParams.get('forever')) await destroyPost(params.id!);
    else await trashPost(params.id!);
    return ok();
  });

export const POST: APIRoute = ({ params, request, locals }) =>
  guard(async () => {
    const { action } = await body<{ action: string }>(request);
    if (action === 'restore') return ok({ post: await restorePost(params.id!) });
    if (action === 'duplicate') return ok({ post: await duplicatePost(params.id!, locals.user!.id) });
    return fail(`Unknown action "${action}".`);
  });
