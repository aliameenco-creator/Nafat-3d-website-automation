// Astro's Node adapter reports every request as http://localhost (it does not trust the Host header unless told
// to), and behind Hostinger's proxy the connection is plain http. So absolute links (canonical URLs, emails,
// sitemap) and the cross-site check use these helpers instead of `url.origin`.
import { site } from '../data/site';

// The address visitors use. In production that is always the live domain; in `npm run dev` it is whatever you opened.
export function siteOrigin(url: URL): string {
  return import.meta.env.PROD ? new URL(site.url).origin : url.origin;
}

// True unless a browser says the request comes from another website. Browsers always send Origin on POSTs.
export function sameOrigin(request: Request, url: URL): boolean {
  const o = request.headers.get('origin');
  if (!o) return true;
  try {
    const h = new URL(o).host;
    const allowed = [url.host, new URL(site.url).host, request.headers.get('host'), request.headers.get('x-forwarded-host')];
    return allowed.includes(h);
  } catch {
    return false;
  }
}
