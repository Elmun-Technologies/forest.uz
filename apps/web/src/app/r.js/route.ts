import { RECORDER_SOURCE, RECORDER_VERSION } from '@forest/replay';

/**
 * `/r.js` — the session replay recorder (rrweb, `@forest/replay`). Static: emitted at build time.
 * Only the replay gate requests it, with `?v=<RECORDER_VERSION>`; the script never changes for a
 * version, so browsers may keep it for a year (the gate always asks for the current version).
 */
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(RECORDER_SOURCE, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      ETag: `"${RECORDER_VERSION}"`,
    },
  });
}
