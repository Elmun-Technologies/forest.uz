import { TRACKER_SOURCE, TRACKER_VERSION } from '@forest/tracker';

/**
 * `/t.js` — the first-party tracker (`@forest/tracker`, docs/07), served from our own origin so
 * it is never blocked as third-party. Static (emitted at build time). Only `TrackerLoader`
 * requests it, always with `?v=<TRACKER_VERSION>`, so browsers may keep it for a year.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(TRACKER_SOURCE, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      ETag: `"${TRACKER_VERSION}"`,
    },
  });
}
