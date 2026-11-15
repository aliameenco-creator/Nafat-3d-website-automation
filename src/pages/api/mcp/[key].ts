import { siteOrigin } from '../../../lib/origin';
import type { APIRoute } from 'astro';
import { mcpEndpoint, notAllowed } from '../../../lib/server/mcp';

export const prerender = false;

// For claude.ai connectors (and Claude's scheduled tasks), which cannot send custom headers:
// the key is part of the URL instead. Treat this URL like a password.
export const POST: APIRoute = ({ request, url, params }) => mcpEndpoint(request, siteOrigin(url), `Bearer ${params.key}`);
export const GET: APIRoute = notAllowed;
export const DELETE: APIRoute = notAllowed;
