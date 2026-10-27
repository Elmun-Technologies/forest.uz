import { NextResponse, type NextRequest } from 'next/server';

const EDGE_HEADER = 'x-forest-edge';
const SECRET = process.env.EDGE_PROXY_SECRET ?? '';

/**
 * Browser → `/api/*` → API rewrite (next.config). Demo (Vercel → Fly, no Caddy): stamp the shared
 * `X-Forest-Edge` secret so the API trusts this hop's X-Forwarded-For (client IP for rate
 * limits); a caller-supplied value is always dropped. Without EDGE_PROXY_SECRET (compose/dev) the
 * request passes untouched unless it tries to send the header itself.
 */
export function forwardToApi(req: NextRequest): NextResponse {
  if (!SECRET && !req.headers.has(EDGE_HEADER)) return NextResponse.next();
  const headers = new Headers(req.headers);
  headers.delete(EDGE_HEADER);
  if (SECRET) headers.set(EDGE_HEADER, SECRET);
  return NextResponse.next({ request: { headers } });
}
