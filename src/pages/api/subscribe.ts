import { siteOrigin, sameOrigin } from '../../lib/origin';
import type { APIRoute } from 'astro';
import { UserError } from '../../lib/server/api';
import { resourcePath } from '../../lib/server/resources';
import { rememberVisitor, unlockResource, visitorFrom } from '../../lib/server/subscribers';

export const prerender = false;

// The "get it free" forms post here: as JSON from scripts/gate.ts, or as a normal form without JavaScript
// (then problems come back as ?error=<code> on the resource page, never as free text in the URL).
export const POST: APIRoute = async (ctx) => {
  const { request, url, cookies } = ctx;
  const json = request.headers.get('content-type')?.includes('application/json') ?? false;
  if (!sameOrigin(request, url)) return Response.json({ error: 'Cross-site request blocked.' }, { status: 403 });

  let input: Record<string, unknown> = {};
  try {
    input = json ? await request.json() : Object.fromEntries(await request.formData());
  } catch {}
  const slug = String(input.resource ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const back = (code: string) => ctx.redirect(slug ? `${resourcePath(slug)}?error=${code}#get` : '/resources/', 303);

  try {
    const result = await unlockResource(input, visitorFrom(request, () => ctx.clientAddress), {
      origin: siteOrigin(url),
      // Emails and the webhook finish after the response, so the visitor is not kept waiting.
      defer: (p) => void p.catch((e) => console.error(e)),
    });
    await rememberVisitor(cookies, result.subscriber);
    const to = `${resourcePath(result.resource.slug)}?unlocked=${result.emailed ? 'sent' : '1'}`;
    return json ? Response.json({ ok: true, redirect: to }) : ctx.redirect(to, 303);
  } catch (e) {
    if (e instanceof UserError) return json ? Response.json({ error: e.message, code: e.code }, { status: e.status }) : back(e.code);
    console.error(e);
    return json ? Response.json({ error: 'Something went wrong on our side. Please try again in a minute.' }, { status: 500 }) : back('server');
  }
};
