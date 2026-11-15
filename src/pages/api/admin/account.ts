import type { APIRoute } from 'astro';
import { body, fail, guard, ok } from '../../../lib/server/api';
import { endOtherSessions, hashPassword, passwordProblem, verifyPassword } from '../../../lib/server/auth';
import { one, run } from '../../../lib/server/db';

export const prerender = false;

type Input = { name?: string; email?: string; currentPassword?: string; newPassword?: string; signOutOthers?: boolean };

export const PATCH: APIRoute = ({ request, locals, cookies }) =>
  guard(async () => {
    const user = locals.user!;
    const b = await body<Input>(request);

    if (b.signOutOthers) {
      await endOtherSessions(cookies, user.id);
      return ok({ message: 'Signed out of every other device.' });
    }

    if (b.newPassword !== undefined) {
      const row = await one<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = ?`, [user.id]);
      if (!row || !(await verifyPassword(String(b.currentPassword ?? ''), row.password_hash))) {
        return fail('Your current password is not right.');
      }
      const problem = passwordProblem(b.newPassword);
      if (problem) return fail(problem);
      await run(`UPDATE users SET password_hash = ? WHERE id = ?`, [await hashPassword(b.newPassword), user.id]);
      await endOtherSessions(cookies, user.id);
      return ok({ message: 'Password changed. Other devices were signed out.' });
    }

    const name = String(b.name ?? user.name).trim();
    const email = String(b.email ?? user.email).trim().toLowerCase();
    if (!name) return fail('Your name cannot be empty.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email address.');
    if (await one(`SELECT id FROM users WHERE email = ? AND id != ?`, [email, user.id])) {
      return fail('Another admin already uses that email.');
    }
    await run(`UPDATE users SET name = ?, email = ? WHERE id = ?`, [name, email, user.id]);
    return ok({ message: 'Profile saved.' });
  });
