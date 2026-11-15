import { siteOrigin } from '../../../../lib/origin';
import type { APIRoute } from 'astro';
import { body, guard, ok } from '../../../../lib/server/api';
import { previewBroadcast, sendTest } from '../../../../lib/server/broadcasts';

export const prerender = false;

type Draft = { subject?: string; preheader?: string; body?: string; test?: boolean };

// Renders the email exactly as people will get it (with your name filled in), or with { test: true }
// sends it to your own address. Nothing is saved.
export const POST: APIRoute = ({ request, url, locals }) =>
  guard(async () => {
    const d = await body<Draft>(request);
    const draft = { subject: String(d.subject ?? ''), preheader: String(d.preheader ?? ''), body: String(d.body ?? '') };
    if (d.test) {
      await sendTest(draft, siteOrigin(url), { email: locals.user!.email, name: locals.user!.name });
      return ok({ sentTo: locals.user!.email });
    }
    return ok(await previewBroadcast(draft, siteOrigin(url), locals.user!.name));
  });
