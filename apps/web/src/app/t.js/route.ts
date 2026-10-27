import type { NextRequest } from 'next/server';
import { TRACKER_SOURCE, TRACKER_VERSION } from '@forest/tracker';

/**
 * `/t.js` — the first-party tracker (`@forest/tracker`, docs/07), served from our own origin so
 * it is never blocked as third-party. `TrackerLoader` always asks for `?v=<TRACKER_VERSION>`:
 * that URL never changes content, so browsers keep it for a year; any other URL (no or an old
 * version) is cached for 5 minutes only, so a stale copy can't outlive a deploy.
 */
export const dynamic = 'force-dynamic';

export function GET(req: NextRequest): Response {
  const current = req.nextUrl.searchParams.get('v') === TRACKER_VERSION;
  return new Response(TRACKER_SOURCE, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': current ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      ETag: `"${TRACKER_VERSION}"`,
    },
  });
}
