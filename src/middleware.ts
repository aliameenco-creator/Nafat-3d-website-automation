import { sameOrigin } from './lib/origin';
import { readFile } from 'node:fs/promises';
// Guards the dashboard and its API (/api/admin). Everything else passes straight through.
// The dashboard pages live in src/pages/[admin] and only answer at the secret address from ADMIN_PATH;
// any other address that lands on them (including /admin) gets the normal 404 page.
import { defineMiddleware } from 'astro:middleware';
import { adminBase, userFromSession } from './lib/server/auth';

export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname;
  // `npm run dev` does not serve public/index.html at '/' (the built server does), so do it here for local viewing.
  if (import.meta.env.DEV && path === '/') {
    return new Response(await readFile('public/index.html'), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  if (ctx.isPrerendered) return next();

  const base = adminBase();
  ctx.locals.admin = base;
  const isAdminPage = (ctx.routePattern ?? '').startsWith('/[admin]');
  const isAdminApi = path.startsWith('/api/admin/');
  if (isAdminPage && path !== base && !path.startsWith(`${base}/`)) return new Response(null, { status: 404 });
  if (!(isAdminPage || isAdminApi)) return next();

  const isLogin = path === `${base}/login` || path === `${base}/login/`;

  // Block cross-site form posts and requests (CSRF). Browsers always send Origin on these.
  if (!['GET', 'HEAD'].includes(ctx.request.method) && !sameOrigin(ctx.request, ctx.url)) {
    return new Response('Cross-site request blocked', { status: 403 });
  }

  let user = null;
  try {
    user = await userFromSession(ctx.cookies);
  } catch (e) {
    // Database not reachable or not configured: let the login page explain it.
    if (!isLogin) {
      if (isAdminApi) return Response.json({ error: String((e as Error).message) }, { status: 503 });
      return ctx.redirect(`${base}/login/`);
    }
  }
  ctx.locals.user = user;

  if (!user && !isLogin) {
    if (isAdminApi) return Response.json({ error: 'Not signed in.' }, { status: 401 });
    const nextUrl = encodeURIComponent(path + ctx.url.search);
    return ctx.redirect(`${base}/login/?next=${nextUrl}`);
  }

  const res = await next();
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'same-origin');
  return res;
});
