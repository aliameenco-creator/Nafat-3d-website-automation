// Markdown → HTML on the server, so readers download no Markdown library.
import { Marked, type Token, type Tokens } from 'marked';
import { youtubeId } from '../youtube';
import { slugify } from './posts';

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const stripInline = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '');

// A free resource link: /resources/<slug>/, the short /r/<slug>, or either with the site's domain.
export const RESOURCE_LINK = /^(?:https?:\/\/[^/\s]+)?\/(?:resources|r)\/([a-z0-9-]+)\/?$/i;

// A YouTube player that plays inside the page. Only the thumbnail loads with the page; scripts/video.ts swaps
// in the real player when it is pressed. Without JavaScript (and in RSS readers) it is a thumbnail linking to
// YouTube. The comment after it marks where withResourceCards puts the resource made from this video.
export function videoHtml(id: string, image?: string, alt?: string) {
  const src = image || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  return `<figure class="yt" data-yt="${id}"><a href="https://www.youtube.com/watch?v=${id}" data-video="${id}" target="_blank" rel="noopener" aria-label="Play video${alt ? `: ${escape(alt)}` : ''}"><img src="${escape(src)}" alt="${escape(alt ?? '')}" loading="lazy" decoding="async" /><span class="yt-play" aria-hidden="true"></span></a></figure>\n<!--resource:video:${id}-->\n`;
}

const significant = (tokens: Token[] = []) => tokens.filter((t) => !(t.type === 'text' && !t.raw.trim()));

function create() {
  const ids = new Map<string, number>();
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading({ tokens, depth, text: raw }: Tokens.Heading) {
        const text = this.parser.parseInline(tokens);
        let id = slugify(stripInline(raw)) || 'section';
        const n = ids.get(id) ?? 0;
        ids.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      // Links to a YouTube video play it on the page (scripts/video.ts) instead of leaving the site.
      link({ href, title, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href) && !href.includes('nafay3d');
        const rel = external ? ' rel="noopener" target="_blank"' : '';
        const t = title ? ` title="${escape(title)}"` : '';
        const video = youtubeId(href);
        return `<a href="${escape(href)}"${t}${rel}${video ? ` data-video="${video}"` : ''}>${text}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        const t = title ? ` title="${escape(title)}"` : '';
        const img = `<img src="${escape(href)}" alt="${escape(text)}"${t} loading="lazy" decoding="async" />`;
        return title ? `<figure>${img}<figcaption>${escape(title)}</figcaption></figure>` : img;
      },
      paragraph({ tokens, text }: Tokens.Paragraph) {
        const raw = text.trim();
        const single = !/\s/.test(raw);
        // A YouTube link on its own line becomes a player.
        const id = single ? youtubeId(raw) : null;
        if (id) return videoHtml(id);
        // So does a thumbnail linked to a video: [![Watch the video](thumbnail.jpg)](https://youtu.be/…)
        const only = significant(tokens);
        if (only.length === 1 && only[0].type === 'link') {
          const link = only[0] as Tokens.Link;
          const inner = significant(link.tokens);
          const vid = youtubeId(link.href);
          if (vid && inner.length === 1 && inner[0].type === 'image') {
            const img = inner[0] as Tokens.Image;
            return videoHtml(vid, img.href, img.text);
          }
        }
        // A free resource link on its own line becomes a sign-up card (see withResourceCards).
        const res = single ? raw.match(RESOURCE_LINK) : null;
        if (res) return `<p data-resource="${res[1].toLowerCase()}">${this.parser.parseInline(tokens)}</p>\n`;
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
      },
    },
  });
  return md;
}

export function renderMarkdown(markdown: string): string {
  return create().parse(markdown, { async: false }) as string;
}

// Headings for the "On this page" list.
export function outline(markdown: string) {
  const out: { depth: number; text: string; id: string }[] = [];
  const seen = new Map<string, number>();
  for (const line of markdown.replace(/```[\s\S]*?```/g, '').split('\n')) {
    const m = line.match(/^(#{2,3})\s+(.+?)\s*#*$/);
    if (!m) continue;
    const text = stripInline(m[2]);
    let id = slugify(text) || 'section';
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n) id = `${id}-${n}`;
    out.push({ depth: m[1].length, text, id });
  }
  return out;
}
