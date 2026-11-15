// Site search over blog posts and free resources. There are hundreds of items at most, so they are matched in
// memory: every word typed must start a word somewhere in the item, and matches in the title count most.
// Pasting a YouTube link finds what was made from that video, whatever the video is called now.
import { youtubeId } from '../youtube';
import { livePosts, type Post } from './posts';
import { liveResources, type Resource } from './resources';

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export function searchWords(q: string) {
  return [...new Set(fold(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1))].slice(0, 8);
}

function rank<T>(items: T[], words: string[], fields: (x: T) => [string, number][]): T[] {
  const patterns = words.map((w) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u'));
  return items
    .map((x) => {
      const texts = fields(x).map(([t, weight]) => [fold(t), weight] as const);
      let score = 0;
      for (const p of patterns) {
        const best = Math.max(0, ...texts.filter(([t]) => p.test(t)).map(([, weight]) => weight));
        if (!best) return { x, score: 0 };
        score += best;
      }
      return { x, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.x);
}

export async function searchSite(q: string, o: { kind?: string } = {}): Promise<{ resources: Resource[]; posts: Post[] }> {
  const [posts, resources] = await Promise.all([livePosts(500), liveResources({ kind: o.kind })]);
  const video = youtubeId(q.trim());
  if (video) {
    return { resources: resources.filter((r) => r.videoId === video), posts: posts.filter((p) => p.content.includes(video)) };
  }
  const words = searchWords(q);
  if (!words.length) return { resources: [], posts: [] };
  return {
    resources: rank(resources, words, (r) => [
      [r.title, 6],
      [`${r.keywords} ${r.videoTitle ?? ''} ${r.tags.join(' ')} ${r.slug.replace(/-/g, ' ')}`, 3],
      [r.summary, 2],
      [r.content, 1],
    ]),
    posts: rank(posts, words, (p) => [
      [p.title, 6],
      [`${p.tags.join(' ')} ${p.focusKeyword ?? ''}`, 3],
      [`${p.excerpt} ${p.metaDescription ?? ''}`, 2],
      [p.content, 1],
    ]),
  };
}
