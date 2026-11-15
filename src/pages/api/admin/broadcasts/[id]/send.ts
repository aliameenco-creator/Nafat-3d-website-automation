import { siteOrigin } from '../../../../../lib/origin';
import type { APIRoute } from 'astro';
import { guard, ok } from '../../../../../lib/server/api';
import { sendNextBatch } from '../../../../../lib/server/broadcasts';

export const prerender = false;

// Sends the next batch of a broadcast (starting it the first time). The editor calls this until done.
export const POST: APIRoute = ({ params, url }) => guard(async () => ok({ progress: await sendNextBatch(params.id!, siteOrigin(url)) }));
