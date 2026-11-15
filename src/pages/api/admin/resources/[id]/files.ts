import type { APIRoute } from 'astro';
import { fail, guard, ok } from '../../../../../lib/server/api';
import { deleteFile, getFile, saveFile } from '../../../../../lib/server/resources';

export const prerender = false;

export const POST: APIRoute = ({ params, request }) =>
  guard(async () => {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail('Choose a file to upload.');
    const saved = await saveFile(params.id!, { bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, mime: file.type });
    return ok({ file: saved }, 201);
  });

// ?file=<id>
export const DELETE: APIRoute = ({ params, url }) =>
  guard(async () => {
    const f = await getFile(url.searchParams.get('file') ?? '');
    if (!f || f.resourceId !== params.id) return fail('Not found', 404);
    await deleteFile(f.id);
    return ok();
  });
