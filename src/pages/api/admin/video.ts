import type { APIRoute } from 'astro';
import { fail, guard, ok } from '../../../lib/server/api';
import { fetchVideoTitle } from '../../../lib/server/resources';
import { youtubeId } from '../../../lib/youtube';

export const prerender = false;

// The editor pastes a YouTube link and gets back the video's id, current title and thumbnail.
export const GET: APIRoute = ({ url }) =>
  guard(async () => {
    const raw = (url.searchParams.get('url') ?? '').trim();
    const id = youtubeId(raw) ?? (/^[\w-]{11}$/.test(raw) ? raw : null);
    if (!id) return fail('That does not look like a YouTube video link.');
    return ok({ id, title: await fetchVideoTitle(id), thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
  });
