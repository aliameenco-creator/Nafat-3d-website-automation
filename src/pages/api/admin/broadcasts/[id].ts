import type { APIRoute } from 'astro';
import { body, fail, guard, ok } from '../../../../lib/server/api';
import { deleteBroadcast, duplicateBroadcast, retryFailed, updateBroadcast, type BroadcastInput } from '../../../../lib/server/broadcasts';

export const prerender = false;

export const PATCH: APIRoute = ({ params, request }) =>
  guard(async () => ok({ broadcast: await updateBroadcast(params.id!, await body<BroadcastInput>(request)) }));

export const DELETE: APIRoute = ({ params }) =>
  guard(async () => {
    await deleteBroadcast(params.id!);
    return ok();
  });

export const POST: APIRoute = ({ params, request }) =>
  guard(async () => {
    const { action } = await body<{ action: string }>(request);
    if (action === 'duplicate') return ok({ broadcast: await duplicateBroadcast(params.id!) });
    if (action === 'retry') return ok({ progress: await retryFailed(params.id!) });
    return fail(`Unknown action "${action}".`);
  });
