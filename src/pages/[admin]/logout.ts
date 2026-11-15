import type { APIRoute } from 'astro';
import { endSession } from '../../lib/server/auth';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect, locals }) => {
  await endSession(cookies);
  return redirect(`${locals.admin}/login/`, 303);
};
