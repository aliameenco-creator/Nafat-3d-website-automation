// The blog's MCP server: a small, stateless implementation of the Streamable HTTP transport.
// Claude Code connects with:  claude mcp add --transport http blog <site>/api/mcp --header "Authorization: Bearer <token>"
import { site } from '../../data/site';
import { adminBase, userFromApiToken, type User } from './auth';
import { saveMedia, saveMediaFromUrl, listMedia } from './media';
import {
  KINDS,
  createResource,
  deleteResource,
  getResource,
  listFiles,
  listResources,
  resourcePath,
  resourceState,
  resourceStats,
  saveFile,
  saveFileFromUrl,
  shortPath,
  updateResource,
  type Resource,
  type ResourceInput,
} from './resources';
import { latestSubscribers, subscriberCounts } from './subscribers';
import { emailSettings } from './email';
import {
  allTags,
  createPost,
  getPost,
  listPosts,
  postCounts,
  postState,
  readingMinutes,
  restorePost,
  slugify,
  seoAudit,
  trashPost,
  updatePost,
  type Post,
  type PostInput,
} from './posts';

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `This server manages the blog on ${site.name}'s website (${site.url}/blog/).
Posts are written in Markdown (GitHub flavoured). Do not repeat the title as a # heading in the body; start with an intro paragraph and use ## and ### for sections.
A YouTube link on its own line becomes an embedded video.
New posts are drafts unless status is "published". A published post with a future publishedAt is scheduled.
For good SEO always set: metaTitle (30–60 chars), metaDescription (120–160 chars), focusKeyword, tags, and a cover image with alt text.
To add an image, call upload_image first and use the returned url. Run seo_audit before publishing and fix what fails.
Free resources (prompts, templates, guides, links, files) live at /resources/. Visitors give their name and email to unlock one, which adds them to the email list.
Put prompts inside \`\`\` code blocks in a resource's content: the page gives each one a Copy button. Set videoUrl to the YouTube video it belongs to:
a blog post showing that video then gets a sign-up card for the resource automatically. Give the shortLink in YouTube descriptions; it survives renames.
Always confirm with the user before publishing or deleting.`;

const seoProps = {
  metaTitle: { type: 'string', description: 'Title tag for Google, 30–60 characters. Defaults to the post title.' },
  metaDescription: { type: 'string', description: 'Snippet under the title in search results, 120–160 characters.' },
  focusKeyword: { type: 'string', description: 'The main phrase this post should rank for.' },
  canonicalUrl: { type: 'string', description: 'Only if the post was first published elsewhere.' },
  ogTitle: { type: 'string', description: 'Title when shared on social media. Defaults to meta title.' },
  ogDescription: { type: 'string', description: 'Description when shared on social media. Defaults to meta description.' },
  ogImage: { type: 'string', description: 'Image when shared on social media, ideally 1200×630. Defaults to the cover image.' },
  noindex: { type: 'boolean', description: 'Hide this post from search engines.' },
};

const postProps = {
  title: { type: 'string' },
  content: { type: 'string', description: 'The post body in Markdown.' },
  slug: { type: 'string', description: 'URL part, e.g. "how-to-start-with-ai". Generated from the title if empty.' },
  excerpt: { type: 'string', description: 'One or two sentence summary shown on the blog list.' },
  tags: { type: 'array', items: { type: 'string' } },
  coverImage: { type: 'string', description: 'Image URL (use upload_image first).' },
  coverAlt: { type: 'string', description: 'Describes the cover image for screen readers and Google.' },
  status: { type: 'string', enum: ['draft', 'published'] },
  publishedAt: { type: 'string', description: 'ISO date. In the future = scheduled. Empty when publishing = now.' },
  ...seoProps,
};

const ref = { type: 'string', description: 'Post id or slug.' };
const resourceRef = { type: 'string', description: 'Resource id or slug.' };

const resourceProps = {
  title: { type: 'string' },
  kind: { type: 'string', enum: Object.keys(KINDS) },
  summary: { type: 'string', description: 'Public description shown on the card and above the sign-up form, max 300 characters.' },
  content: { type: 'string', description: 'Locked Markdown shown after sign-up. Put each prompt in a ``` code block.' },
  linkUrl: { type: 'string', description: 'Main link after sign-up, e.g. a Google Drive folder.' },
  linkLabel: { type: 'string', description: 'Button text for linkUrl. Optional.' },
  videoUrl: { type: 'string', description: 'YouTube link of the video this resource is from.' },
  videoTitle: { type: 'string', description: "Fetched from YouTube when empty. Kept for search after the video is renamed." },
  slug: { type: 'string' },
  tags: { type: 'array', items: { type: 'string' } },
  keywords: { type: 'string', description: 'Extra words people might search for, like an old video title.' },
  coverImage: { type: 'string', description: "Image URL (use upload_image first). Defaults to the video's thumbnail." },
  status: { type: 'string', enum: ['draft', 'published'] },
  publishedAt: { type: 'string', description: "ISO date shown on the page, usually the video's date. In the future = scheduled." },
};

const TOOLS = [
  {
    name: 'blog_overview',
    title: 'Blog overview',
    description: 'Counts of published, scheduled and draft posts, recent posts and all tags in use.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_posts',
    title: 'List posts',
    description: 'List posts with their status, URL and SEO score. Filter by state, search text or tag.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['all', 'draft', 'scheduled', 'published', 'trash'] },
        search: { type: 'string' },
        tag: { type: 'string' },
        limit: { type: 'number', description: 'Default 20, max 100.' },
        offset: { type: 'number' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_post',
    title: 'Get post',
    description: 'Get one post with its full Markdown content and all SEO fields.',
    inputSchema: { type: 'object', properties: { post: ref }, required: ['post'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_post',
    title: 'Create post',
    description: 'Create a blog post. It is saved as a draft unless status is "published".',
    inputSchema: { type: 'object', properties: postProps, required: ['title', 'content'] },
  },
  {
    name: 'update_post',
    title: 'Update post',
    description:
      'Change any fields of a post; fields you leave out stay as they are. Set status "published" to publish, "draft" to unpublish.',
    inputSchema: { type: 'object', properties: { post: ref, ...postProps }, required: ['post'] },
  },
  {
    name: 'delete_post',
    title: 'Move post to trash',
    description: 'Move a post to the trash (it stops showing on the site). It can be restored from the dashboard or with restore_post.',
    inputSchema: { type: 'object', properties: { post: ref }, required: ['post'] },
    annotations: { destructiveHint: true },
  },
  {
    name: 'restore_post',
    title: 'Restore post',
    description: 'Bring a post back from the trash. It keeps its previous status.',
    inputSchema: { type: 'object', properties: { post: ref }, required: ['post'] },
  },
  {
    name: 'seo_audit',
    title: 'SEO audit',
    description: 'Score a post (0–100) against an SEO checklist and list what to fix. Pass a post, or draft fields to check before saving.',
    inputSchema: { type: 'object', properties: { post: ref, ...postProps } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'upload_image',
    title: 'Upload image',
    description:
      'Store an image on the site and get back its URL for coverImage or Markdown. Give either a public sourceUrl, or base64 data with a mimeType. Max 1.9 MB.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceUrl: { type: 'string', description: 'Public URL of the image to copy onto the site.' },
        data: { type: 'string', description: 'Base64-encoded image bytes.' },
        mimeType: { type: 'string', description: 'e.g. image/png, needed with data.' },
        filename: { type: 'string' },
        alt: { type: 'string', description: 'Alt text describing the image.' },
      },
    },
  },
  {
    name: 'list_images',
    title: 'List images',
    description: 'List images already uploaded to the site.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_resources',
    title: 'List free resources',
    description: 'List free resources with their status, short link and how many people unlocked them. Search by text or YouTube link.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['all', 'draft', 'scheduled', 'published'] },
        search: { type: 'string' },
        limit: { type: 'number', description: 'Default 20, max 100.' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_resource',
    title: 'Get free resource',
    description: 'Get one resource with its locked content, files and stats.',
    inputSchema: { type: 'object', properties: { resource: resourceRef }, required: ['resource'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_resource',
    title: 'Create free resource',
    description: 'Create a free resource that visitors unlock with their name and email. Saved as a draft unless status is "published".',
    inputSchema: { type: 'object', properties: resourceProps, required: ['title'] },
  },
  {
    name: 'update_resource',
    title: 'Update free resource',
    description: 'Change any fields of a resource; fields you leave out stay as they are. Changing the slug keeps the old link working.',
    inputSchema: { type: 'object', properties: { resource: resourceRef, ...resourceProps }, required: ['resource'] },
  },
  {
    name: 'delete_resource',
    title: 'Delete free resource',
    description: 'Delete a resource and its files for good. Its links stop working. To hide it instead, set status "draft".',
    inputSchema: { type: 'object', properties: { resource: resourceRef }, required: ['resource'] },
    annotations: { destructiveHint: true },
  },
  {
    name: 'attach_file',
    title: 'Attach file to resource',
    description: 'Add a downloadable file (PDF, ZIP, JSON…, up to 20 MB) to a resource, from a public sourceUrl or base64 data.',
    inputSchema: {
      type: 'object',
      properties: {
        resource: resourceRef,
        sourceUrl: { type: 'string' },
        data: { type: 'string', description: 'Base64-encoded file bytes.' },
        filename: { type: 'string', description: 'Needed with data, e.g. "workflow.json".' },
      },
      required: ['resource'],
    },
  },
  {
    name: 'audience_overview',
    title: 'Email list overview',
    description: 'Subscriber counts, the newest subscribers, which resources bring in the most people, and whether email sending is set up.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
];

// Links point at whichever address Claude connected to (localhost while testing, the live domain in production).
let absolute = (path: string) => new URL(path, site.url).href;

function summary(p: Post) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    state: postState(p),
    url: absolute(`/blog/${p.slug}/`),
    publishedAt: p.publishedAt ? new Date(p.publishedAt).toISOString() : null,
    updatedAt: new Date(p.updatedAt).toISOString(),
    tags: p.tags,
    seoScore: seoAudit(p).score,
  };
}

function full(p: Post) {
  const { deletedAt: _d, createdAt, updatedAt, publishedAt, ...rest } = p;
  return {
    ...rest,
    state: postState(p),
    url: absolute(`/blog/${p.slug}/`),
    editUrl: absolute(`${adminBase()}/posts/${p.id}/`),
    publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
    readingMinutes: readingMinutes(p.content),
  };
}

function audit(p: Parameters<typeof seoAudit>[0]) {
  const { score, checks } = seoAudit(p);
  return { score, failing: checks.filter((c) => !c.ok).map((c) => (c.tip ? `${c.label} — ${c.tip}` : c.label)) };
}

function pickInput(args: Record<string, unknown>): PostInput {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(postProps)) if (k in args) out[k] = args[k];
  return out as PostInput;
}

async function mustGet(ref: unknown) {
  const p = await getPost(String(ref ?? ''));
  if (!p) throw new Error(`No post found for "${ref}". Use list_posts to find the id or slug.`);
  return p;
}

async function mustGetResource(ref: unknown) {
  const r = await getResource(String(ref ?? ''));
  if (!r) throw new Error(`No resource found for "${ref}". Use list_resources to find the id or slug.`);
  return r;
}

function resourceSummary(r: Resource, stats?: { views: number; unlocks: number }) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    kind: r.kind,
    state: resourceState(r),
    url: absolute(resourcePath(r.slug)),
    shortLink: absolute(shortPath(r.slug)),
    videoId: r.videoId,
    videoTitle: r.videoTitle,
    publishedAt: r.publishedAt ? new Date(r.publishedAt).toISOString() : null,
    ...(stats ? { views: stats.views, unlocks: stats.unlocks } : {}),
  };
}

function pickResource(args: Record<string, unknown>): ResourceInput {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(resourceProps)) if (k in args) out[k] = args[k];
  return out as ResourceInput;
}

async function callTool(name: string, args: Record<string, unknown>, user: User): Promise<unknown> {
  switch (name) {
    case 'blog_overview': {
      const [counts, recent, tags] = await Promise.all([postCounts(), listPosts({ limit: 8 }), allTags()]);
      return { site: absolute('/blog/'), counts, recent: recent.posts.map(summary), tags };
    }
    case 'list_posts': {
      const limit = Math.min(Number(args.limit) || 20, 100);
      const { posts, total } = await listPosts({
        state: args.state as never,
        search: args.search as string | undefined,
        tag: args.tag as string | undefined,
        limit,
        offset: Number(args.offset) || 0,
      });
      return { total, posts: posts.map(summary) };
    }
    case 'get_post':
      return full(await mustGet(args.post));
    case 'create_post': {
      const p = await createPost(pickInput(args), user.id);
      return { created: full(p), seo: audit(p) };
    }
    case 'update_post': {
      const p = await updatePost((await mustGet(args.post)).id, pickInput(args));
      return { updated: full(p), seo: audit(p) };
    }
    case 'delete_post': {
      const p = await trashPost((await mustGet(args.post)).id);
      return { trashed: p.title, note: 'Restore it with restore_post or from the dashboard trash.' };
    }
    case 'restore_post': {
      const p = await restorePost((await mustGet(args.post)).id);
      return { restored: summary((await getPost(p.id))!) };
    }
    case 'seo_audit': {
      const base = args.post
        ? await mustGet(args.post)
        : { title: '', slug: '', content: '', excerpt: '', coverImage: null, coverAlt: null, tags: [], metaTitle: null, metaDescription: null, focusKeyword: null, ogImage: null, noindex: false };
      const draft = { ...base, ...pickInput(args) } as Parameters<typeof seoAudit>[0] & { tags: unknown };
      if (typeof draft.tags === 'string') draft.tags = (draft.tags as string).split(',');
      if (!draft.slug && draft.title) draft.slug = slugify(draft.title);
      return seoAudit(draft as Parameters<typeof seoAudit>[0]);
    }
    case 'upload_image': {
      let m;
      if (args.sourceUrl) m = await saveMediaFromUrl(String(args.sourceUrl), args.alt as string | undefined, new URL(absolute('/')).origin);
      else if (args.data) {
        const b64 = String(args.data).replace(/^data:[^,]+,/, '');
        m = await saveMedia({
          bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
          mime: String(args.mimeType || String(args.data).match(/^data:([^;]+)/)?.[1] || ''),
          filename: String(args.filename || 'image'),
          alt: args.alt as string | undefined,
        });
      } else throw new Error('Give either sourceUrl or data.');
      return { url: m.url, publicUrl: absolute(m.url), markdown: `![${m.alt}](${m.url})`, size: m.size, note: 'Use url (a site path) for coverImage, ogImage and inside Markdown.' };
    }
    case 'list_images':
      return (await listMedia(Math.min(Number(args.limit) || 50, 200))).map((m) => ({ ...m, url: absolute(m.url) }));
    case 'list_resources': {
      const { resources, total } = await listResources({
        state: args.state as never,
        search: args.search as string | undefined,
        limit: Math.min(Number(args.limit) || 20, 100),
      });
      const stats = await resourceStats(resources.map((r) => r.id));
      return { total, resources: resources.map((r) => resourceSummary(r, stats.get(r.id))) };
    }
    case 'get_resource': {
      const r = await mustGetResource(args.resource);
      const [files, stats] = await Promise.all([listFiles(r.id), resourceStats([r.id])]);
      return {
        ...resourceSummary(r, stats.get(r.id)),
        summary: r.summary,
        content: r.content,
        linkUrl: r.linkUrl,
        linkLabel: r.linkLabel,
        tags: r.tags,
        keywords: r.keywords,
        coverImage: r.coverImage,
        oldSlugs: r.oldSlugs,
        files: files.map((f) => ({ id: f.id, filename: f.filename, size: f.size })),
        stats: stats.get(r.id),
        editUrl: absolute(`${adminBase()}/resources/${r.id}/`),
      };
    }
    case 'create_resource': {
      const r = await createResource(pickResource(args));
      return { created: resourceSummary(r), editUrl: absolute(`${adminBase()}/resources/${r.id}/`) };
    }
    case 'update_resource': {
      const r = await updateResource((await mustGetResource(args.resource)).id, pickResource(args));
      return { updated: resourceSummary(r) };
    }
    case 'delete_resource': {
      const r = await deleteResource((await mustGetResource(args.resource)).id);
      return { deleted: r.title };
    }
    case 'attach_file': {
      const r = await mustGetResource(args.resource);
      let f;
      if (args.sourceUrl) f = await saveFileFromUrl(r.id, String(args.sourceUrl), args.filename as string | undefined);
      else if (args.data) {
        const b64 = String(args.data).replace(/^data:[^,]+,/, '');
        f = await saveFile(r.id, { bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), filename: String(args.filename || 'file') });
      } else throw new Error('Give either sourceUrl or data.');
      return { attached: { id: f.id, filename: f.filename, size: f.size }, resource: resourceSummary(r) };
    }
    case 'audience_overview': {
      const [counts, latest, { resources }] = await Promise.all([subscriberCounts(), latestSubscribers(10), listResources({ state: 'published', limit: 100 })]);
      const stats = await resourceStats(resources.map((r) => r.id));
      const top = resources
        .map((r) => ({ title: r.title, shortLink: absolute(shortPath(r.slug)), ...stats.get(r.id)! }))
        .sort((a, b) => b.unlocks - a.unlocks)
        .slice(0, 10);
      return {
        counts,
        emailSending: emailSettings() ? 'on' : 'off (add RESEND_API_KEY and EMAIL_FROM)',
        newest: latest.map((s) => ({ name: s.name, email: s.email, joined: new Date(s.createdAt).toISOString(), through: s.source, status: s.status })),
        topResources: top,
        subscribersUrl: absolute(`${adminBase()}/subscribers/`),
      };
    }
    default:
      throw new RpcError(-32602, `Unknown tool: ${name}`);
  }
}

class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: Record<string, unknown> };

async function handle(msg: Rpc, user: User) {
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '');
      return {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'nafay3d-site', title: `${site.name} blog`, version: '1.0.0' },
        instructions: INSTRUCTIONS,
      };
    }
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (!TOOLS.some((t) => t.name === name)) throw new RpcError(-32602, `Unknown tool: ${name}`);
      try {
        const result = await callTool(name, args, user);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        // Tool errors go back to Claude as readable text so it can correct itself.
        return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
      }
    }
    case 'resources/list':
      return { resources: [] };
    case 'prompts/list':
      return { prompts: [] };
    default:
      throw new RpcError(-32601, `Method not found: ${msg.method}`);
  }
}

export async function respond(body: unknown, user: User, origin: string): Promise<Response> {
  absolute = (path: string) => new URL(path, origin).href;
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as Rpc[];
  const replies = [];
  for (const msg of messages) {
    if (!msg || msg.jsonrpc !== '2.0') {
      replies.push({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } });
      continue;
    }
    // Notifications and client responses carry no id and get no reply.
    if (msg.id === undefined || !msg.method) continue;
    try {
      replies.push({ jsonrpc: '2.0', id: msg.id, result: await handle(msg, user) });
    } catch (e) {
      const code = e instanceof RpcError ? e.code : -32603;
      replies.push({ jsonrpc: '2.0', id: msg.id, error: { code, message: (e as Error).message } });
    }
  }
  if (!replies.length) return new Response(null, { status: 202 });
  return Response.json(batch ? replies : replies[0]);
}

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

// Shared by /api/mcp (key in the Authorization header) and /api/mcp/<key> (key in the URL).
export async function mcpEndpoint(request: Request, origin: string, authorization: string | null): Promise<Response> {
  const user = await userFromApiToken(authorization);
  if (!user) {
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing or invalid API key. Create one in the dashboard under Claude / MCP.' } },
      { status: 401, headers: HEADERS },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers: HEADERS });
  }
  const res = await respond(body, user, origin);
  for (const [k, v] of Object.entries(HEADERS)) res.headers.set(k, v);
  return res;
}

// This server never pushes messages, so there is no SSE stream to open and no session to end.
export const notAllowed = () => new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST', ...HEADERS } });
