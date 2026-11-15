import type { APIRoute } from 'astro';
import { body, guard, ok } from '../../../../lib/server/api';
import { createResource, type ResourceInput } from '../../../../lib/server/resources';

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  guard(async () => ok({ resource: await createResource(await body<ResourceInput>(request)) }, 201));
