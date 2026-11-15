/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: import('./lib/server/auth').User | null;
    // Where the dashboard lives, e.g. "/admin" or the secret "/k3v9-…" (see ADMIN_PATH in the README).
    admin: string;
  }
}
