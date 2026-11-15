// @ts-check
import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';

// The live address of the site. Hostinger runs this as a Node.js app (see README → Deploy to Hostinger).
// `/` is Nafay's original homepage, served untouched from public/index.html. The blog, resources, the hidden
// dashboard and the API opt out of static building with `prerender = false`.
export default defineConfig({
  site: 'https://nafay3d.com',
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  build: { inlineStylesheets: 'always' },
  security: { checkOrigin: false }, // origin checks are done by hand in the middleware and API routes
  env: {
    schema: {
      // Creates the first admin account on first sign-in, when no admin exists yet.
      ADMIN_EMAIL: envField.string({ context: 'server', access: 'secret', optional: true }),
      ADMIN_PASSWORD: envField.string({ context: 'server', access: 'secret', optional: true }),
      // The secret dashboard address, e.g. "k3v9-xq7m-2pdz". Without it the dashboard stays at /admin.
      ADMIN_PATH: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Emails (resource delivery and broadcasts) go out through Resend. Both are needed to send.
      RESEND_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      EMAIL_FROM: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Optional: every new sign-up and unsubscribe is also POSTed here (n8n, Zapier, Make…).
      LEADS_WEBHOOK_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Sign-ups are also sent to this Kit form (defaults to the AI Brief form on the homepage).
      KIT_FORM_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});
