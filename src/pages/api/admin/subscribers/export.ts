import type { APIRoute } from 'astro';
import { exportCsv } from '../../../../lib/server/subscribers';

export const prerender = false;

// The list as a CSV file for any email tool, with the proof of consent for each person.
// Takes the same filters as the Subscribers page: ?status=&resource=&q=
export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams;
  const csv = await exportCsv({ status: q.get('status') ?? undefined, resource: q.get('resource') ?? undefined, search: q.get('q') ?? undefined });
  const day = new Date().toISOString().slice(0, 10);
  // The byte-order mark makes Excel read names with accents correctly.
  return new Response(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="subscribers-${day}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
};
