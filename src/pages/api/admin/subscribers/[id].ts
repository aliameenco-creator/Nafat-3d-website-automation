import type { APIRoute } from 'astro';
import { body, fail, guard, ok } from '../../../../lib/server/api';
import { deleteSubscriber, getSubscriber, unsubscribe, visitorFrom } from '../../../../lib/server/subscribers';

export const prerender = false;

// Admins can unsubscribe someone (e.g. they asked by email) but never subscribe anyone: only the person can.
export const PATCH: APIRoute = (ctx) =>
  guard(async () => {
    const { action } = await body<{ action: string }>(ctx.request);
    if (action !== 'unsubscribe') return fail(`Unknown action "${action}".`);
    const s = await unsubscribe(ctx.params.id!, visitorFrom(ctx.request, () => ctx.clientAddress), `Unsubscribed by ${ctx.locals.user!.name} in the dashboard`);
    return s ? ok({ subscriber: s }) : fail('Not found', 404);
  });

export const DELETE: APIRoute = ({ params }) =>
  guard(async () => {
    if (!(await getSubscriber(params.id!))) return fail('Not found', 404);
    await deleteSubscriber(params.id!);
    return ok();
  });
