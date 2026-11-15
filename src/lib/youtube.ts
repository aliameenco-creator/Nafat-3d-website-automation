import { youtube } from '../data/site';

// The 11-character video id from any YouTube address (watch, youtu.be, shorts, live, embed), or null.
// The id never changes, so it is what resources and posts are matched on, even after a video is renamed.
export function youtubeId(url: string | null | undefined): string | null {
  const s = String(url ?? '').trim();
  const m =
    s.match(/^https?:\/\/(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|live\/|embed\/|v\/)([\w-]{11})(?![\w-])/i) ??
    s.match(/^https?:\/\/youtu\.be\/([\w-]{11})(?![\w-])/i);
  return m ? m[1] : null;
}

export interface Video {
  id: string;
  title: string;
  description: string;
  published: string;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

// YouTube keeps an automatic "Videos" playlist per channel (id starts with UULF) that leaves out Shorts,
// so only long-form videos are shown.
const longFormPlaylist = 'UULF' + youtube.channelId.slice(2);

// Reads the public feed when the site is built. If YouTube can't be reached
// the pages still build, they just show no videos until the next deploy.
export async function getLatestVideos(limit = 12): Promise<Video[]> {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${longFormPlaylist}`);
    if (!res.ok) return [];
    const xml = await res.text();
    const entries = xml.split('<entry>').slice(1);
    return entries
      .map((e) => ({
        id: e.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1] ?? '',
        title: decode(e.match(/<title>(.*?)<\/title>/)?.[1] ?? ''),
        description: decode(e.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? '').trim(),
        published: e.match(/<published>(.*?)<\/published>/)?.[1] ?? '',
      }))
      .filter((v) => v.id)
      .slice(0, limit);
  } catch {
    return [];
  }
}
