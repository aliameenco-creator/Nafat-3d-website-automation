import type { APIRoute } from 'astro';
import { body, guard, ok } from '../../../../lib/server/api';
import { createBroadcast, type BroadcastInput } from '../../../../lib/server/broadcasts';

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  guard(async () => ok({ broadcast: await createBroadcast(await body<BroadcastInput>(request).catch(() => ({}))) }, 201));
