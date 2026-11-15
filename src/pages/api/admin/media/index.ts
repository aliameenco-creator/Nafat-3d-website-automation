import type { APIRoute } from 'astro';
import { fail, guard, ok } from '../../../../lib/server/api';
import { listMedia, saveMedia } from '../../../../lib/server/media';

export const prerender = false;

export const GET: APIRoute = () => guard(async () => ok({ media: await listMedia() }));

export const POST: APIRoute = ({ request }) =>
  guard(async () => {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail('Choose an image to upload.');
    const num = (k: string) => (form.get(k) ? Number(form.get(k)) || null : null);
    const media = await saveMedia({
      bytes: new Uint8Array(await file.arrayBuffer()),
      mime: file.type,
      filename: file.name,
      alt: String(form.get('alt') ?? ''),
      width: num('width'),
      height: num('height'),
    });
    return ok({ media }, 201);
  });
