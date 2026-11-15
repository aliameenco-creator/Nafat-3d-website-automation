import type { APIRoute } from 'astro';
import { userFromSession } from '../../../lib/server/auth';
import { fileStream, getFile, getResource, isLive, resourcePath } from '../../../lib/server/resources';
import { recordDownload, visitorFrom, visitorSubscriber } from '../../../lib/server/subscribers';

export const prerender = false;

// Downloads for files attached to a resource. Only people who unlocked it on this browser (or a signed-in
// admin) get the file; anyone else is sent to the resource page to sign up first.
export const GET: APIRoute = async (ctx) => {
  const file = await getFile(ctx.params.id!);
  const resource = file && (await getResource(file.resourceId));
  if (!file || !resource) return new Response(null, { status: 404 });

  const subscriber = isLive(resource) ? await visitorSubscriber(ctx.cookies) : null;
  if (!subscriber && !(await userFromSession(ctx.cookies))) {
    return isLive(resource) ? ctx.redirect(`${resourcePath(resource.slug)}#get`, 302) : new Response(null, { status: 404 });
  }
  if (subscriber) {
    const v = visitorFrom(ctx.request, () => ctx.clientAddress);
    await recordDownload(subscriber, resource, file.filename, { ...v, page: resourcePath(resource.slug) });
  }

  const ascii = file.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return new Response(fileStream(file), {
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
};
