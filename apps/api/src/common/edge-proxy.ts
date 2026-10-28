import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const EDGE_HEADER = 'x-forest-edge';

const digest = (v: string) => createHash('sha256').update(v, 'utf8').digest();

/**
 * Demo (Vercel → Fly, no Caddy): only requests the storefront/admin middleware proxied carry the
 * shared `X-Forest-Edge` secret, and only their X-Forwarded-For chain is trusted
 * (`TRUST_PROXY_HOPS`). Any other request keeps just the last entry — the address the platform
 * proxy appended for its real peer — so a direct caller can't choose its client IP. The header is
 * removed before anything else sees it (logs, handlers).
 */
export function edgeProxyGate(secret: string) {
  const expected = digest(secret);
  return (req: IncomingMessage, _res: unknown, next: () => void): void => {
    const got = req.headers[EDGE_HEADER];
    delete req.headers[EDGE_HEADER];
    if (typeof got === 'string' && timingSafeEqual(digest(got), expected)) return next();
    const xff = req.headers['x-forwarded-for'];
    const hops = (Array.isArray(xff) ? xff.join(',') : (xff ?? ''))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (hops.length > 1) req.headers['x-forwarded-for'] = hops[hops.length - 1];
    next();
  };
}
