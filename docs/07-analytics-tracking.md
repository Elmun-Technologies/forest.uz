# 07 · First-party analytics, heatmaps, attribution

Goal from owner: no need to install Google Analytics or Yandex Metrika for analytics. Everything — visitors, exits, funnels, sources/ROAS, heatmaps, session replays, customer journeys — lives in our DB and admin (A1–A8). External pixels exist only as **ad optimization signals**.

## Tracker (`packages/tracker`)
- Tiny script (< 6 KB gz core) served from our domain (`/t.js`) → not blocked as third-party.
- IDs:
  - `fr_aid` — anonymous visitor id (UUID v7), first-party cookie, 13 months, `SameSite=Lax`, `Secure`.
  - `sessionId` — new after 30 min inactivity or new UTM campaign; stored in sessionStorage + cookie.
  - `customerId` — attached server-side after identification (never PII in client events).
- Batching: queue in memory, flush every 5 s / 20 events / `visibilitychange` via `navigator.sendBeacon` → `POST /v1/t`.
- Auto events: `page_view` (with SPA route changes), `scroll_depth` (25/50/75/100), `click` (selector + relative x/y + viewport — for heatmaps), `rage_click` (≥3 clicks in 700 ms same area), `dead_click` (click with no DOM/route change in 1 s), `form_error`, `js_error`, `web_vitals` (LCP/INP/CLS), `exit` (last page).
- Commerce events (fire explicitly): `view_item_list`, `view_item`, `select_variant`, `calculator_used`, `selector_used`, `selector_result`, `add_to_cart`, `remove_from_cart`, `view_cart`, `promo_applied`/`promo_rejected`, `begin_checkout`, `add_shipping_info`, `add_payment_info`, `purchase` (server-side only, on PAID or COD CONFIRMED), `lead` (popup/selector/bot phone), `search` (q, results), `waitlist_join`, `telegram_click`, `video_play`.
- Capture UTM (`utm_source/medium/campaign/content/term`) and click ids (`fbclid`, `gclid`, `ttclid`, `yclid`) on landing; persist first/last touch on the visitor.
- Consent: essential analytics on by default (first-party, aggregated); **session replay only after consent** and sampled (default 30 % of sessions, 100 % of sessions that reach checkout `[confirm]`). Marketing pixels only after marketing consent.

## Ingest pipeline
`POST /v1/t` → zod validate → drop bots (UA list + behavior) → enrich: UA → device/os/browser; IP → city/region via local GeoIP DB (DB-IP Lite or MaxMind GeoLite2, refreshed monthly; **raw IP not stored**, only truncated /24 for 7 days for fraud) → channel classification (rules below) → insert `Event` rows (COPY/batch insert) → upsert `Session` aggregates → push to Redis stream for realtime ("Hozir saytda", live pages, live sources).

Channel rules (first match): click id/`utm_medium=cpc|paid` → `paid_<source>`; `utm_source=telegram|t.me` referrer → `telegram`; search engine referrer → `organic_search`; social referrer → `organic_social`; `utm_medium=sms` → `sms`; `bot` → `bot`; other referrer → `referral`; none → `direct`.

## Session replay & heatmaps
- **rrweb** recorder loaded lazily (after consent + sampling), masks all inputs by default (`maskAllInputs`), plus `data-private` elements (phone, name, address, card fields). Chunks (gzip) uploaded every 10 s → object storage `replays/{date}/{sessionId}/{n}.json.gz`; `Session.hasReplay=true`. Retention 30 days.
- Player in A3 (rrweb-player) with event markers: page, click, error, exit, rage click.
- Heatmaps: aggregate `click` events per `path × device × day` into grid buckets (relative x‰ of page width, absolute y px of document) + per-selector counts ("most clicked elements"); scroll map from `scroll_depth`. Render heatmap over a stored page screenshot (Playwright job captures each top page weekly at 1440 & 390) or live iframe of the page.
- Auto-insights (A3 "Avtomatik topilgan muammolar"): rules — high dead-click selectors, rage-click hotspots, sections reached by < 50 % on mobile, exit rate spike after a CTA, slow LCP per page.

## Reports (A2) — computed by SQL/materialized views
- Realtime: active users (last 30 min), active pages, current sources, geo.
- Sources & campaigns: sessions, bounce, avg time, leads, orders, revenue, **ad spend (imported), ROAS** per source/medium/campaign/content.
- Landing & exit pages with bounce/exit rates → link to sessions on that page.
- Events & goals: conversion rate of sessions that did event X vs overall (e.g. selector users ×3).
- Funnel: visit → view_item → add_to_cart → begin_checkout → purchase, by device/channel.
- Devices & regions conversion. Cohorts: repeat purchase by first-purchase month.
- Period compare (vs previous period).

## Attribution
- Journey per customer = ordered touches (sessions with channel/campaign) from first visit to purchase, plus bot/SMS touches.
- Models available in admin (A7 switch): **first touch, last non-direct touch (default), linear**. Order stores computed shares in `Order.attribution`.
- Revenue per channel in A2 uses the selected model.
- CAC per customer ≈ allocated ad spend of their touched campaigns (A5).

## Identity stitching
`anonymousId` ↔ `customerId` linked on lead, OTP login, checkout, bot phone share (`Visitor.customerId`). Past anonymous sessions of that visitor are re-attributed to the customer (journey completeness).

## Ad signals (server-side forwarding)
On `lead`, `add_to_cart`, `begin_checkout`, `purchase` → queue → Meta CAPI / Google Ads / TikTok Events (if connected) with the same event id as the browser pixel, hashed identifiers only, consent-respecting. Failures retried; status visible in A10 logs.

## Audiences (A8)
Rule builder over: events (did/didn't, within N days, page conditions like "time on /p/divan-toplami > 30 s"), orders (count, sum, last order date, product bought/not bought), consents (SMS, Telegram, ads), tags, region, device. Hourly refresh → `SegmentMember`. Destinations: Meta Custom Audience, Google Customer Match, TikTok, Yandex Audiences (hashed phones, consented only), Telegram/SMS automation (template + delay, with caps). Preset segments from design: abandoned cart 7 d, viewed sofa kit >30 s no purchase, leads without purchase, bought spray not cleaner (21 d upsell), VIP (≥ 2 000 000 so'm), inactive 60+ d.

## Scale notes
Postgres is fine to ~10–20 M events/month with monthly partitions + BRIN index on `ts` + aggregates. If traffic outgrows it, move `Event` to ClickHouse behind the same ingest interface (document trigger in CLAUDE.md).
