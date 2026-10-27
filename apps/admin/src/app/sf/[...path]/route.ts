import { isProxiedAsset } from '../../../lib/snapshot';

const WEB = (
  process.env.WEB_INTERNAL_URL ??
  process.env.APP_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');

export const dynamic = 'force-dynamic';

const PASS_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified'];

/**
 * Same-origin proxy for the heatmap backdrop's storefront assets (`/_next/static/*`, the image
 * optimizer). Public files only; fonts need same-origin to load inside the admin's srcdoc frame.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const path = (await params).path.join('/');
  if (!isProxiedAsset(path)) return new Response('Not found', { status: 404 });
  const search = new URL(req.url).search;
  let res: Response;
  try {
    res = await fetch(`${WEB}/${path}${search}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return new Response('Storefront unreachable', { status: 502 });
  }
  const headers = new Headers();
  for (const h of PASS_HEADERS) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers });
}
