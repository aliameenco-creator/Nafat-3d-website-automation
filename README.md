# nafay3d.com: homepage + blog + free resources

One Astro app (Node adapter, SQLite) that runs on a Hostinger Node.js app.

- `/` is Nafay's **original homepage**, served untouched from `public/index.html` (mirrored from the live site, with
  its `assets/`, `skills/` and `styles/` folders). The only change is two extra nav links: **Blog** and **Resources**.
- `/blog/` and `/resources/` are new, styled with the same fonts (Young Serif + Figtree) and colours as the homepage.
- A hidden dashboard and a Claude (MCP) server let Nafay run the blog and resources from Claude Code.

## Run it locally

Needs Node 22.13 or newer.

```bash
npm install
cp .env.example .env   # then fill in ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_PATH; keep KIT_FORM_ID=off
npm run dev
```

Open http://localhost:4321. The database file is created at `DB_PATH` on the first request.

## Where to edit

| What | Where |
|---|---|
| Name, newsletter link, Kit form id, consent wording, nav, reply-to email, postal address | `src/data/site.ts` |
| Colours and fonts of blog/resources/dashboard | variables at the top of `src/styles/global.css` |
| The homepage | `public/index.html` (leave it alone unless you mean to change it) |
| Posts, images, resources, subscribers, emails | the dashboard, or Claude Code through MCP |

## Dashboard (secret address)

It answers only at `/<ADMIN_PATH>/`. Every other address, `/admin` included, shows the normal 404. Sign in with
the email and password from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (they only create the first account; change the password
under **Account**). Five wrong tries in 15 minutes lock that email and IP for 15 minutes.

Sections: Overview, Posts (Markdown editor, drafts, scheduling, SEO checklist), Media, Resources (email-gated
prompts, templates, files), Subscribers (consent proof, CSV export), Emails (broadcasts), Claude / MCP, Team, Account.

## Controlling the site from Claude Code

1. Dashboard -> **Claude / MCP** -> create a key.
2. Run the command it shows once (looks like `claude mcp add --scope user --transport http nafay3d-site https://nafay3d.com/api/mcp --header "Authorization: Bearer blog_..."`).
3. In Claude Code ask for things like "write a post about X and save it as a draft" or "create a free resource with this prompt".

Tools: `blog_overview`, `list_posts`, `get_post`, `create_post`, `update_post`, `delete_post`, `restore_post`,
`seo_audit`, `upload_image`, `list_images`, `list_resources`, `get_resource`, `create_resource`, `update_resource`,
`delete_resource`, `attach_file`, `audience_overview`.

## Sign-ups: own database + Kit

Every resource unlock is saved in the local subscriber list (with time, page, IP, country and the exact consent
wording) **and** copied into the Kit form from the homepage (`newsletter.kitFormId` in `src/data/site.ts`, form
10095875). Set `KIT_FORM_ID=off` on your own computer so tests never reach the real list. Optional: `LEADS_WEBHOOK_URL`
sends each sign-up to n8n/Zapier/Make.

## Email (Resend)

Until set up, people still get the resource on the page; only the email copy is skipped.

1. Create a Resend account, add `nafay3d.com` under Domains, add the DNS records in Hostinger (hPanel -> Domains -> DNS).
2. Create an API key.
3. Set `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `Nafay 3D <hello@nafay3d.com>`) as environment variables.
4. Fill in `email` (reply-to) and `postalAddress` in `src/data/site.ts` before sending broadcasts.

## Deploy to Hostinger

1. hPanel -> **Websites** -> your site -> **Node.js** (Node.js Web App). Choose Node **22.13+** (24 is fine).
2. Upload this project (GitHub import or a zip **without** `node_modules`, `dist` and `data`).
3. Build command `npm install && npm run build`. Start command `npm start`. Entry file `dist/server/entry.mjs`.
4. Add environment variables: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_PATH`, `DB_PATH`, `HOST=0.0.0.0`, `RESEND_API_KEY`,
   `EMAIL_FROM`. (`PORT` is normally supplied by Hostinger; if the panel asks, use the port it shows.)
5. **`DB_PATH` must be outside the app folder**, e.g. `/home/<user>/nafay-data/nafay.sqlite`, so redeploys never
   wipe the database. Back that file up (hPanel backups or copy it down regularly): it holds posts, images,
   resource files and subscribers.
6. Open `https://nafay3d.com/` (homepage must look exactly as before), then `https://nafay3d.com/<ADMIN_PATH>/`.

Important: this app takes over the whole domain. Before switching, keep a copy of the current `public_html`, and
make sure the Node app is the one attached to `nafay3d.com`. The homepage files live in `public/` and are served by
the app itself.

## Notes

- Uses Node's built-in SQLite (`node:sqlite`), so nothing native needs compiling. Node prints an "experimental"
  warning; that is expected.
- Images are stored in the database (max 1.9 MB each); resource files up to 20 MB are stored there too. Share larger
  files as a Google Drive link in the resource's Link field.
- `/sitemap.xml` and `/rss.xml` are generated automatically; `robots.txt` points to the sitemap.
