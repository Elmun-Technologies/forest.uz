import { routeAllowed, STOREFRONT_INTERNAL } from '../../../lib/route-auth';
import { proxiedAssetUrl } from '../../../lib/snapshot';

export const dynamic = 'force-dynamic';

const PASS_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified'];

/**
 * Same-origin proxy for the A3 heatmap backdrop and the replay player: storefront build assets
 * (`/_next/static/*`) and the image optimizer only, for signed-in staff with `analytics.view`.
 * Fonts must be same-origin to load inside the admin's frames (and the admin CSP is 'self').
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const url = proxiedAssetUrl(
    STOREFRONT_INTERNAL,
    (await params).path.join('/'),
    new URL(req.url).search,
  );
  if (!url) return new Response('Not found', { status: 404 });
  if (!(await routeAllowed('analytics.view'))) return new Response('Forbidden', { status: 403 });
  let res: Response;
  try {
    res = await fetch(url, {
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return new Response('Storefront unreachable', { status: 502 });
  }
  if (res.status >= 300 && res.status < 400) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  for (const h of PASS_HEADERS) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Staff-only now: keep it out of shared caches.
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(res.body, { status: res.status, headers });
}
