# @forest/tracker

First-party analytics script (docs/07 "Tracker"). One minified IIFE, **< 6 KB gzip** (enforced by
`src/size.test.ts`), served by the storefront from its own origin as `/t.js` and loaded after idle.

```
pnpm --filter @forest/tracker build   # dist/t.js + dist/index.js (TRACKER_SOURCE, TRACKER_VERSION)
pnpm --filter @forest/tracker test    # build + jsdom unit tests + size budget
```

## How it is loaded

- `apps/web/src/app/t.js/route.ts` serves `TRACKER_SOURCE` (force-static, `immutable`, one year);
  the loader always requests `/t.js?v=<TRACKER_VERSION>` (content hash), so a new build is a new URL.
- `apps/web/src/middleware.ts` issues `fr_aid` on the first page response, so every beacon carries
  the visitor id (otherwise concurrent first-visit beacons would each get a different one).
- `apps/web/src/components/analytics/tracker-loader.tsx` injects `<script src="/t.js?v=…" async>`
  via `onIdle` (no request before the page is idle; Lighthouse budget).
- Storefront code fires commerce events with `track(name, props)` from `apps/web/src/lib/track.ts`
  (types from `@forest/contracts/core`). Calls made before the script runs are queued in
  `window.__frq` and sent once it starts.

## What it sends

`POST /api/t` (→ API `/v1/t`), `text/plain` JSON via `navigator.sendBeacon` (fallback
`fetch(keepalive)`), never retried:

```json
{ "v": 1, "sid": "<uuid v7>", "now": 1730000000000, "wd": false,
  "events": [{ "id": "<uuid v7>", "name": "click", "t": 1730000000000, "path": "/uz/p/divan",
               "props": { "tag": "button", "track": "add_to_cart" },
               "selector": "#main>section>button", "x": 512, "y": 1340, "viewportW": 390 }] }
```

- Flush every 5 s, at 20 events, on `visibilitychange → hidden` and on `pagehide`.
- Session: UUID v7 in the `fr_sid` cookie (30 min sliding = inactivity timeout, shared by tabs);
  a landing URL with a different `utm_campaign` (or a click id) starts a new one.
- Auto events: `page_view` (load + Next client navigations via `history` patch/`popstate`; the
  landing one carries `referrer`, `utm`, `clickIds`), `scroll_depth` (25/50/75/100), `click`
  (`selector`, `x` ‰ of document width, `y` document px, `viewportW`, `props.track` = closest
  `data-track`), `rage_click` (3 clicks / 700 ms / 30 px), `dead_click` (no DOM or URL change within
  1 s), `form_error` (`invalid` events and `aria-invalid="true"`: field **name** only), `js_error`
  (message without URL query strings, ≤ 5 per page), `web_vitals` (LCP/INP/CLS from
  PerformanceObserver, sent once when the page is hidden), `exit` (on `pagehide`).
- Click goals: elements with `data-track="telegram_click"` / `"video_play"` (and any `t.me` link)
  also send that event.
- Paths are pathname only; `/t/<token>` → `/t/:token`, `/buyurtma/<id>` → `/buyurtma/:id`, segments
  that look like a phone/email → `:redacted` (`scrubPath` in `@forest/contracts`). The API
  re-validates everything (`trackEventSchema`), so the script is not the privacy boundary.
- Never read: `fr_aid` (httpOnly visitor id, set by the API), input values, text content.

## Consent

Reads `fr_consent`. Tracking runs unless `analytics === false`; when the visitor opts out
(`fr:consent` event) it stops at once, drops the queue and deletes `fr_sid`.

## Extension hook (session replay, agent 3)

`window.__forestTracker` exists once the script ran:

| member | |
|---|---|
| `sessionId(): string \| null` | current session id (null while tracking is off) |
| `consent(): {analytics, marketing, replay} \| null` | parsed `fr_consent` |
| `onConsent(fn): () => void` | called on every `fr:consent` decision; returns unsubscribe |
| `onSession(fn): () => void` | called with the current id at once and on every new session |
| `track(name, props)` | same as `lib/track.ts` |
| `flush()` | send the queue now |

A replay recorder should be lazy-loaded from `onConsent`/start-up when `consent()?.replay` (or
`analytics`, per agent 3's rule) is true, tag chunks with `sessionId()` and restart on `onSession`.
Elements with `data-private` (phone, name, address, comment inputs) must be masked.
