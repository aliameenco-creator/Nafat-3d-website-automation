// Sending email through Resend's HTTP API (plain fetch, so it needs no SDK) and the templates:
// the email that delivers a resource, and the layout and Markdown renderer for broadcasts.
// To switch provider later, only sendMail and sendMany need to change.
import { getSecret } from 'astro:env/server';
import { Marked, type Token, type Tokens } from 'marked';
import { site, newsletter, youtube } from '../../data/site';
import { youtubeId } from '../youtube';
import { RESOURCE_LINK } from './markdown';
import { findLiveResource, kindWord, resourcePath, type Resource } from './resources';
import { sign } from './tokens';

export function emailSettings() {
  const key = getSecret('RESEND_API_KEY')?.trim();
  const from = getSecret('EMAIL_FROM')?.trim();
  return key && from ? { key, from } : null;
}

export const NOT_SET_UP = 'Email sending is not set up yet. Add RESEND_API_KEY and EMAIL_FROM (see README → Email).';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export type SendResult = { ok: true } | { ok: false; error: string; retry?: boolean; quota?: boolean };

async function call(path: string, body: unknown, key: string, extra: Record<string, string> = {}) {
  try {
    const res = await fetch(`https://api.resend.com${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { message: `Could not reach Resend: ${(e as Error).message}` } as Record<string, any> };
  }
}

function failure(status: number, data: Record<string, any>): SendResult {
  const name = String(data.name ?? '');
  const error = String(data.message ?? data.error ?? `Resend answered ${status}`);
  if (/quota/i.test(name) || /quota/i.test(error)) return { ok: false, error, quota: true };
  if (status === 429 || status === 0 || status >= 500) return { ok: false, error, retry: true };
  return { ok: false, error };
}

const toResend = (m: Mail, from: string) => ({
  from,
  to: [m.to],
  subject: m.subject,
  html: m.html,
  text: m.text,
  ...(site.email ? { reply_to: site.email } : {}),
  headers: m.headers,
});

export async function sendMail(m: Mail): Promise<SendResult> {
  const s = emailSettings();
  if (!s) return { ok: false, error: NOT_SET_UP };
  const res = await call('/emails', toResend(m, s.from), s.key);
  return res.ok ? { ok: true } : failure(res.status, res.data);
}

// Up to 100 emails in one request. In "permissive" mode Resend sends the good ones even if one address fails.
export async function sendMany(list: Mail[]): Promise<SendResult[]> {
  const s = emailSettings();
  if (!s) return list.map(() => ({ ok: false, error: NOT_SET_UP }));
  if (!list.length) return [];
  const res = await call('/emails/batch', list.map((m) => toResend(m, s.from)), s.key, { 'x-batch-validation': 'permissive' });
  if (!res.ok) {
    const f = failure(res.status, res.data);
    return list.map(() => f);
  }
  const errors = new Map<number, string>(
    ((res.data.errors ?? []) as { index: number; message: string }[]).map((e) => [Number(e.index), String(e.message)]),
  );
  return list.map((_, i) => (errors.has(i) ? { ok: false, error: errors.get(i)! } : { ok: true }));
}

// ---------- Template ----------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
const ACCENT = '#e8532b';
const S = {
  p: 'margin:0 0 16px;font-size:16px;line-height:1.65;color:#141414',
  h1: `margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:32px;line-height:1.15;color:#141414`,
  h2: `margin:28px 0 12px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:26px;line-height:1.2;color:#141414`,
  h3: 'margin:24px 0 10px;font-size:18px;font-weight:600;line-height:1.3;color:#141414',
  ul: 'margin:0 0 16px;padding-left:22px',
  ol: 'margin:0 0 16px;padding-left:22px',
  li: 'margin:0 0 6px;font-size:16px;line-height:1.6;color:#141414',
  blockquote: 'margin:0 0 16px;padding:2px 0 2px 16px;border-left:3px solid #e8532b;color:#3d3d3d',
  pre: 'margin:0 0 16px;padding:14px 16px;background:#f6f5f2;border:1px solid #e6e4df;border-radius:8px;white-space:pre-wrap;word-break:break-word',
  code: 'font-family:Menlo,Consolas,monospace;font-size:14px;background:#f6f5f2;padding:1px 5px;border-radius:4px',
  hr: 'border:0;border-top:1px solid #e6e4df;margin:28px 0',
  a: `color:${ACCENT};text-decoration:underline`,
  img: 'display:block;max-width:100%;height:auto;border:0;border-radius:8px;margin:0 0 16px',
  muted: 'margin:0 0 16px;font-size:15px;line-height:1.6;color:#6b6b6b',
};

export function button(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px"><tr><td style="border-radius:999px;background:${ACCENT}"><a href="${esc(href)}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:999px">${esc(label)}</a></td></tr></table>`;
}

export function layout(o: { title: string; preheader?: string; body: string; footer: string }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f3f0">
${o.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(o.preheader)}${'&#8199;&#65279;&#847;'.repeat(40)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f0"><tr><td align="center" style="padding:32px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 6px 16px;font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#141414">${esc(site.name)}</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e6e4df;border-radius:14px;padding:32px 28px;font-family:${FONT};font-size:16px;line-height:1.65;color:#141414">${o.body}</td></tr>
<tr><td style="padding:18px 10px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#6b6b6b;text-align:center">${o.footer}</td></tr>
</table></td></tr></table></body></html>`;
}

export function emailFooter(reason: string, unsubUrl: string) {
  const address = site.postalAddress.trim() ? `<br>${esc(site.postalAddress.trim())}` : '';
  return `${esc(reason)}<br><a href="${esc(unsubUrl)}" style="color:#6b6b6b;text-decoration:underline">Unsubscribe</a>${address}`;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

// Links that carry the person's signed id: open a resource without the form, and one-click unsubscribe.
export async function personalLinks(origin: string, subscriberId: string) {
  const [access, unsub] = await Promise.all([sign('access', subscriberId), sign('unsub', subscriberId)]);
  return {
    access,
    unsubPage: `${origin}/unsubscribe/?t=${encodeURIComponent(unsub)}`,
    // Gmail and Yahoo show their own "Unsubscribe" button using these headers, and require them for bulk mail.
    headers: {
      'List-Unsubscribe': `<${origin}/api/unsubscribe?t=${encodeURIComponent(unsub)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

// ---------- The email that delivers a resource ----------

export async function resourceEmail(o: {
  subscriber: { id: string; name: string; email: string };
  resource: Resource;
  isNew: boolean;
  origin: string;
}): Promise<Mail> {
  const { resource: r, origin } = o;
  const links = await personalLinks(origin, o.subscriber.id);
  const open = `${origin}${resourcePath(r.slug)}?k=${encodeURIComponent(links.access)}`;
  const word = kindWord(r.kind);
  const hi = firstName(o.subscriber.name) || 'there';
  const host = new URL(origin).host;
  const intro = `I'm ${site.name}. I make videos about AI tools, 3D and building income online on YouTube (${youtube.handle}). When I share a new prompt, template or guide, I'll send it to you here. If that's not for you, unsubscribe with one click at the bottom.`;
  const ps = `Want a short weekly email on new AI tools? Get ${newsletter.name}:`;

  const html = layout({
    title: r.title,
    preheader: r.summary || `Here is the ${word} you asked for.`,
    body: [
      `<p style="${S.p}">Hi ${esc(hi)},</p>`,
      `<p style="${S.p}">Here is the ${esc(word)} you asked for: <b>${esc(r.title)}</b>.</p>`,
      r.summary ? `<p style="${S.muted}">${esc(r.summary)}</p>` : '',
      button(open, `Open the ${word}`),
      o.isNew ? `<p style="${S.p}">${esc(intro)}</p>` : '',
      `<p style="${S.p}">Questions or stuck somewhere? Just reply to this email.</p>`,
      `<p style="${S.p}">${esc(firstName(site.name))}</p>`,
      `<hr style="${S.hr}">`,
      `<p style="${S.muted}"><b style="color:#141414">P.S.</b> ${esc(ps)} <a href="${esc(newsletter.url)}" style="${S.a}">join here</a>.</p>`,
    ].join('\n'),
    footer: emailFooter(`You're getting this because you asked for “${r.title}” at ${host}.`, links.unsubPage),
  });
  const text = [
    `Hi ${hi},`,
    `Here is the ${word} you asked for: ${r.title}.`,
    r.summary,
    `Open it here: ${open}`,
    o.isNew ? intro : '',
    'Questions or stuck somewhere? Just reply to this email.',
    firstName(site.name),
    `P.S. ${ps} ${newsletter.url}`,
    '--',
    `You're getting this because you asked for "${r.title}" at ${host}. Unsubscribe: ${links.unsubPage}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { to: o.subscriber.email, subject: `Your free ${word}: ${r.title}`, html, text, headers: links.headers };
}

// ---------- Broadcasts: Markdown → email HTML ----------

const significant = (tokens: Token[] = []) => tokens.filter((t) => !(t.type === 'text' && !t.raw.trim()) && t.type !== 'br');

// The single link in a paragraph, also when it is bold: **[Join now](https://…)**
function loneLink(tokens: Token[]): Tokens.Link | null {
  const only = significant(tokens);
  if (only.length !== 1) return null;
  const t = only[0];
  if (t.type === 'link') return t as Tokens.Link;
  if (t.type === 'strong' || t.type === 'em') return loneLink((t as Tokens.Strong).tokens);
  return null;
}

// %%ACCESS%% in resource links is swapped for each person's own key, so the resource opens without the form.
export async function emailMarkdown(markdown: string, origin: string) {
  const abs = (u: string) => {
    try {
      return new URL(u, origin).href;
    } catch {
      return u;
    }
  };
  const slugs = [...markdown.matchAll(/^\s*(\S+)\s*$/gm)].map((m) => m[1].match(RESOURCE_LINK)?.[1]?.toLowerCase()).filter(Boolean) as string[];
  const resources = new Map<string, Resource>();
  for (const s of new Set(slugs)) {
    const found = await findLiveResource(s);
    if (found) resources.set(s, found.resource);
  }

  const video = (id: string, image?: string) =>
    `<p style="${S.p}"><a href="https://www.youtube.com/watch?v=${id}"><img src="${esc(abs(image || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`))}" alt="Watch the video on YouTube" width="502" style="${S.img};width:100%"></a></p>`;
  const resourceBlock = (r: Resource) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #e6e4df;border-radius:12px;background:#fbfaf8"><tr><td style="padding:18px 20px 2px">
<p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${ACCENT}">Free ${esc(kindWord(r.kind))}</p>
<p style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.2;color:#141414">${esc(r.title)}</p>
${r.summary ? `<p style="${S.muted}">${esc(r.summary)}</p>` : ''}
${button(`${abs(resourcePath(r.slug))}?k=%%ACCESS%%`, `Get the ${kindWord(r.kind)}`)}
</td></tr></table>`;

  // breaks: a new line in the editor is a new line in the email, as people expect when writing a letter.
  const md = new Marked({ gfm: true, breaks: true });
  md.use({
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const d = Math.min(depth, 3);
        return `<h${d} style="${d === 1 ? S.h1 : d === 2 ? S.h2 : S.h3}">${this.parser.parseInline(tokens)}</h${d}>\n`;
      },
      link({ href, tokens }: Tokens.Link) {
        return `<a href="${esc(abs(href))}" style="${S.a}">${this.parser.parseInline(tokens)}</a>`;
      },
      image({ href, text }: Tokens.Image) {
        return `<img src="${esc(abs(href))}" alt="${esc(text)}" style="${S.img}">`;
      },
      paragraph({ tokens, text }: Tokens.Paragraph) {
        const raw = text.trim();
        // A YouTube link on its own line becomes a thumbnail that opens the video.
        const id = !/\s/.test(raw) ? youtubeId(raw) : null;
        if (id) return video(id);
        // A free resource link on its own line becomes a card with a button.
        const res = !/\s/.test(raw) ? raw.match(RESOURCE_LINK) : null;
        if (res && resources.has(res[1].toLowerCase())) return resourceBlock(resources.get(res[1].toLowerCase())!);
        const link = loneLink(tokens);
        if (link) {
          const inner = significant(link.tokens);
          const vid = youtubeId(link.href);
          if (vid && inner.length === 1 && inner[0].type === 'image') return video(vid, (inner[0] as Tokens.Image).href);
          // Any other link on its own line becomes a button.
          if (!inner.some((t) => t.type === 'image')) return button(abs(link.href), link.text.replace(/[*_`]/g, ''));
        }
        return `<p style="${S.p}">${this.parser.parseInline(tokens)}</p>\n`;
      },
    },
  });
  const html = md.parse(markdown, { async: false }) as string;
  return html
    .replace(/<pre><code([^>]*)>/g, `<pre style="${S.pre}"><code$1 style="font-family:Menlo,Consolas,monospace;font-size:14px">`)
    .replace(/<(ul|ol|li|blockquote|code|hr)(\s[^>]*)?>/g, (m, tag: keyof typeof S, attrs = '') =>
      attrs.includes('style=') ? m : `<${tag}${attrs} style="${S[tag]}">`,
    );
}

// Plain-text version of a broadcast, for email apps that do not show HTML.
export function markdownToText(markdown: string, origin: string) {
  const abs = (u: string) => {
    try {
      return new URL(u, origin).href;
    } catch {
      return u;
    }
  };
  return markdown
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\(([^)\s]+)[^)]*\)/g, (_, u: string) => `Watch: ${abs(u)}`)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, t: string, u: string) => `${t} (${abs(u)})`)
    .replace(/^\s*(\/(?:resources|r)\/[a-z0-9-]+\/?)\s*$/gim, (_, u: string) => `${abs(u)}?k=%%ACCESS%%`)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/^>\s?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

