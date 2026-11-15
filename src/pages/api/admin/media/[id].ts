import type { APIRoute } from 'astro';
import { body, guard, ok } from '../../../../lib/server/api';
import { deleteMedia, updateMediaAlt } from '../../../../lib/server/media';

export const prerender = false;

export const PATCH: APIRoute = ({ params, request }) =>
  guard(async () => {
    const { alt } = await body<{ alt: string }>(request);
    await updateMediaAlt(params.id!, String(alt ?? ''));
    return ok();
  });

export const DELETE: APIRoute = ({ params }) =>
  guard(async () => {
    await deleteMedia(params.id!);
    return ok();
  });
