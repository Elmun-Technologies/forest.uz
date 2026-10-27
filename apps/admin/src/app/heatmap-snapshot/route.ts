import { hasPermission } from '@forest/contracts/core';
import { getMe } from '../../lib/api';
import { isSnapshotPath, sanitizeSnapshot } from '../../lib/snapshot';

/** Storefront origin as seen from the admin server (compose: `http://web:3000`). */
const WEB = (
  process.env.WEB_INTERNAL_URL ??
  process.env.APP_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');

export const dynamic = 'force-dynamic';

/**
 * A3 heatmap backdrop: the current storefront page as anonymous, script-free HTML for a sandboxed
 * `srcdoc` iframe (CLAUDE.md §6). Needs a full admin session with `analytics.view`.
 */
export async function GET(req: Request): Promise<Response> {
  const me = await getMe().catch(() => null);
  if (!me || me.stage !== 'full' || !hasPermission(me.staff.role, 'analytics.view'))
    return new Response('Forbidden', { status: 403 });
  const path = new URL(req.url).searchParams.get('path') ?? '/';
  if (!isSnapshotPath(path)) return new Response('Bad path', { status: 400 });
  let res: Response;
  try {
    // No cookies: the page renders as for an anonymous first visit.
    res = await fetch(`${WEB}/uz${path === '/' ? '' : path}`, {
      cache: 'no-store',
      redirect: 'follow',
      headers: { 'Accept-Language': 'uz', 'User-Agent': 'ForestAdminHeatmap/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return new Response('Storefront unreachable', { status: 502 });
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('text/html')) return new Response('Not a page', { status: 502 });
  return new Response(sanitizeSnapshot(await res.text()), {
    status: res.ok ? 200 : res.status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "script-src 'none'; object-src 'none'",
    },
  });
}
