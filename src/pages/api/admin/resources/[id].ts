import type { APIRoute } from 'astro';
import { body, fail, guard, ok } from '../../../../lib/server/api';
import { deleteResource, getResource, listFiles, updateResource, type ResourceInput } from '../../../../lib/server/resources';

export const prerender = false;

export const GET: APIRoute = ({ params }) =>
  guard(async () => {
    const resource = await getResource(params.id!);
    return resource ? ok({ resource, files: await listFiles(resource.id) }) : fail('Not found', 404);
  });

export const PATCH: APIRoute = ({ params, request }) =>
  guard(async () => ok({ resource: await updateResource(params.id!, await body<ResourceInput>(request)) }));

export const DELETE: APIRoute = ({ params }) =>
  guard(async () => {
    await deleteResource(params.id!);
    return ok();
  });
