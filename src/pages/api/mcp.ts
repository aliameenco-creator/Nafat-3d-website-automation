import { siteOrigin } from '../../lib/origin';
import type { APIRoute } from 'astro';
import { mcpEndpoint, notAllowed } from '../../lib/server/mcp';

export const prerender = false;

// For Claude Code: the key is sent as an "Authorization: Bearer …" header.
export const POST: APIRoute = ({ request, url }) => mcpEndpoint(request, siteOrigin(url), request.headers.get('authorization'));
export const GET: APIRoute = notAllowed;
export const DELETE: APIRoute = notAllowed;
