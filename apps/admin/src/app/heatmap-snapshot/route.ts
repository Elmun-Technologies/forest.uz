import { routeAllowed, STOREFRONT_INTERNAL } from '../../lib/route-auth';
import { sanitizeSnapshot, snapshotUrl } from '../../lib/snapshot';

export const dynamic = 'force-dynamic';

const MAX_REDIRECTS = 3;

/**
 * A3 heatmap backdrop: the current storefront page as anonymous, script-free HTML for a sandboxed
 * `srcdoc` iframe (CLAUDE.md §6). Needs a full admin session with `analytics.view`. Redirects
 * (slug moves) are followed only to other storefront locale pages.
 */
export async function GET(req: Request): Promise<Response> {
  if (!(await routeAllowed('analytics.view'))) return new Response('Forbidden', { status: 403 });
  let url = snapshotUrl(STOREFRONT_INTERNAL, new URL(req.url).searchParams.get('path') ?? '/');
  if (!url) return new Response('Bad path', { status: 400 });
  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS && url; hop++) {
    try {
      // No cookies: the page renders as for an anonymous first visit.
      res = await fetch(url, {
        cache: 'no-store',
        redirect: 'manual',
        headers: { 'Accept-Language': 'uz', 'User-Agent': 'ForestAdminHeatmap/1.0' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return new Response('Storefront unreachable', { status: 502 });
    }
    if (res.status < 300 || res.status >= 400) break;
    const next: URL = new URL(res.headers.get('location') ?? '', url);
    const local = next.pathname.replace(/^\/(?:uz|ru)(?=\/|$)/, '') || '/';
    url = next.origin === url.origin ? snapshotUrl(STOREFRONT_INTERNAL, local) : null;
    res = null;
  }
  if (!res) return new Response('Redirected away', { status: 502 });
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
