# Progress

Current phase: **Phase 1 — done** (one acceptance item open: Product Lighthouse perf median 89 in the sandbox) · **Phase 2 — done** (providers unverified against live sandboxes — see open questions 28–59) · **Phase 3 — done** (MoySklad verified only against a fake server — open questions 60–69) · **Phases 4–5 — done** (external platforms only against fakes — open questions 70–103) · **Phase 6 — done** (go-live: `docs/launch-checklist.md`).

| Phase | Status | Notes |
|---|---|---|
| 0 Foundation | done | see report below |
| 1 Storefront | done | see report below; Product perf 89 (target 90) |
| 2 Payments/delivery/SMS/auth | done | see report below; real provider runs need owner credentials + sandbox |
| 3 Admin core | done | see report below; MoySklad needs owner token + account setup |
| 4 Analytics/heatmaps/audiences/SEO | done | see report below; ad/search platforms need owner credentials |
| 5 Bot/automations/content | done | see report below; bot token, Claude key, Eskiz re-approval |
| 6 Hardening & launch | done | see report below; go-live needs the UZ VPS, staging drills and owner credentials |

## Phase 6 — Hardening & launch kit (done, 2026-10-27)

### Built
- **Production deploy** `infra/deploy/deploy.sh` (preflight → build/pull by git sha → pre-migration dump → migrate as owner → `db-roles.sql` → up → health → automatic rollback), `compose.prod.yml` (only Caddy publishes ports, internal network for Redis, limits, log rotation), API as `forest_app` with append-only AuditLog, storefront × `WEB_REPLICAS`.
- **Security**: static CSP via Caddy (storefront) + admin CSP in `next.config.ts`, HSTS/nosniff/COOP; ASVS L2 review (`docs/security/asvs-l2.md`); fixed from it: image metadata (EXIF/GPS) stripped on every stored image, master key rotation (`APP_ENCRYPTION_KEY_PREVIOUS` + `rotate-keys`), raw event 13-month and IntegrationLog retention job, failed admin logins audited.
- **Backups**: pgBackRest full/diff + WAL (PITR), nightly `pg_dump`, encrypted object backup (replays excluded), monthly restore drill, systemd timers.
- **Monitoring**: GlitchTip (in-repo Sentry-protocol reporter for api/web/admin servers) + Uptime Kuma on a second UZ host, alerts to the Telegram admin group.
- **Load tests** (k6, `loadtest/`), **launch checklist** (`docs/launch-checklist.md`) and runbooks: deploy-and-rollback, restore-db, payment-incident, moysklad-sync-failure, secret-rotation, monitoring, incident-contacts.

### Verified
- Prod-like compose on the dev host: first deploy + seed, redeploy 28 s, broken release → automatic rollback, manual rollback 20 s; `csp-check.mjs` 27 storefront + 21 admin pages, 0 violations, enforcement probes pass; restore drill 14/14 sanity checks (also via encrypted S3); `forest_app` can't UPDATE/DELETE AuditLog or run DDL; k6 smoke (results in `loadtest/README.md`).
- API integration 414+ tests, unit suites, typecheck, lint, format green locally.

### Not verified / owner input
- PITR drill (pgBackRest image can't be built in this sandbox), Telegram widget without `'unsafe-eval'`, load test on production-sized hardware: run on staging.
- Owner provides: UZ VPS + UZ S3 backup bucket + second UZ host for monitoring, `.env` / `.env.ops`, incident contacts, firewall/NTP/Cloudflare rules, passphrases and `APP_ENCRYPTION_KEY` in a password manager; then `docs/launch-checklist.md`.
- Open ASVS items (owner/backlog): 4-digit customer OTP (F-03), TOTP only for Owner/Manager (F-04), admin nonce CSP (F-06), `SESSION_SECRET` rotation (F-07) and the lows F-09–F-15, F-17.

## Phase 5 — Bot, automations, content (done, 2026-10-27)

### Built
- **Telegram bot** (grammY, webhook mode, secret path + header): `/start` deep links (lead, signed single-use visitor reference, order tracking), phone sharing via `request_contact` only (Telegram-verified → account link, SALOM10), order status, advice with operator hours, review flow (stars → text/photos → RAHMAT5 + photo consent; ≤ 3★ → complaint), `/til`, `/stop`; admin alerts group (new order, ≤ 3★, complaint, failed payment, SLA risk, integration errors). Fake transport in fake mode.
- **A12 bot admin + inbox**: KPIs, scenario switches with 30-day metrics, complaint keywords; operator inbox (status tabs, signed photo URLs, replies with product cards → cart-restore links, assign, close/reopen).
- **Messaging engine** (one dispatcher for every customer message): service / requested / marketing kinds, consent per channel, ≤ 1 marketing message per day, quiet hours (deferred, never dropped), Telegram → SMS fallback, opt-out on every marketing message (`/obuna/<token>`), unapproved SMS texts never sent. Automations: abandoned cart (Telegram 2 h / SMS 24 h), review request, waitlist back-in-stock, audience auto-messages. A12 templates editor (`/bot/messages`) with test send to the staff member's own phone.
- **A10 outbound webhooks** (signed, outbox with 8 attempts + auto-disable, SSRF guard checked inside the connection) and **partner API keys** (read-only products/stock, per-key rate limit).
- **CMS**: Ilhom articles (blocks, cover, video, related products, per-locale publishing, SEO, 301 on slug change) and the Brend page; storefront `/ilhom`, `/ilhom/[slug]`, `/brend`.
- **AI drafts** (Claude via the official SDK; fake in fake mode): product description, SEO meta, operator reply (off by default, Owner switch, PII scrubbed) — drafts only, never saved automatically; audited, rate limited.

### Verified
- Integration tests: bot (synthetic updates through the real webhook route), messaging policy/automations, webhooks-out (signing, retries, SSRF), partner API, CMS, AI (fake); admin e2e for bot inbox, messages, content; `bot-cart-restore.spec.ts` (Phase 5 acceptance: abandoned-cart message → link restores the cart → checkout).
- Totals at the end of Phases 4–5: API integration 411/411, all unit suites green, Playwright desktop + mobile green in CI.

### Independent review — fixed
Webhook SSRF via DNS rebinding (vetted address handed to the socket), SMS marketing templates without an opt-out slot refused, bot `/start` no longer re-grants consent after an opt-out elsewhere, cart-restore GET only for top-level navigation, deep links never attach accounts, erasure covers the Telegram chat and replays.

### Not verified / owner input
- Telegram Bot API, Eskiz and Claude were exercised only through fakes (official doc hosts unreachable from dev): see open questions 70–103. Needs: bot token (BotFather) + admin group chat id, Claude API key, Eskiz re-approval of the new SMS texts with `{stop}` (`cart_abandoned_24h_sms`, `review_request_sms`, waitlist), lawyer review of q.85, 93, 101.

## Phase 4 — Analytics, heatmaps, audiences, SEO (done, 2026-10-27)

### Built
- **Tracker** `/t.js` (4.7 KB gz, budget 6 KB): sessions, page views, clicks/rage/dead clicks, scroll depth, web vitals, commerce events; consent-aware, PII scrubbed in the browser and again in the API; ingest `POST /v1/t` (bots dropped, GeoIP in-repo, channel classifier, realtime keys); identity stitching only after a verified login; server-side `purchase`/`lead` events.
- **A1 dashboard / A2 analytics**: KPIs, visits, funnel, sources/channels, pages, events & goals, devices, cohorts, realtime; attribution (first touch, last non-direct, linear) stored per order; ad spend CSV import + adapter, ROAS/CAC; customer and order journeys (A5/A7).
- **A3 heatmaps & replay**: hourly aggregates (click/rage/dead cells, elements, scroll, LCP), problem list, backdrop = sanitized live storefront page; rrweb replay (`/r.js`, consent + sampling, inputs masked, URLs scrubbed, 30-day retention), audited replay open.
- **A8 audiences**: rule builder compiled to one SQL query (preview = refresh), hourly refresh with membership history and 30-day results, preset segments, hashed-phone uploads to Meta/Google/TikTok/Yandex (consent-gated, diff sync), server-side ad signals (CAPI, Google Ads, TikTok Events).
- **A9 SEO center**: health score, per-page meta overrides read by the storefront, redirects (no chains/loops), 404 log with suggestions, verification codes, robots/sitemaps/IndexNow served by the API, schema toggles, search queries (GSC/Yandex Webmaster), CWV field data + PageSpeed; on-demand storefront revalidation (signed).

### Verified
- Acceptance (docs/12): synthetic traffic (`e2e/synthetic`) → dashboard numbers equal psql truth (`admin-analytics.spec.ts`); replay plays with masked inputs (`replay.spec.ts`); audience preview equals hand-written SQL (integration); tracker < 6 KB gz (`size.test.ts`); no PII in the events table (integration test).

### Independent review — fixed
`/sf` asset proxy path traversal, identity stitching on unverified checkout/lead phones removed, signed 404 reports (no planted "broken links"), redirect slash-variant loop, replay upload checks (session owner, consent, caps), scrubbing of capability paths (`/obuna`, `/c`) incl. a data migration; worker shutdown order (orphaned idle transactions locking `Event`).

### Not verified / owner input
- Ad platforms, GSC/Yandex Webmaster, PageSpeed run only against fakes: see open questions 70–103. Needs: Meta/Google/TikTok/Yandex credentials + consent texts, GSC service account / YWM OAuth token, verification codes, lawyer review of q.85 (analytics banner copy).

## Phase 3 — Admin core (done, 2026-10-27)

### Built
- **Auth & access**: staff login (argon2 password + mandatory TOTP for Owner/Manager, in-repo RFC 6238 with replay guard), invites, 12 h absolute sessions, double-submit CSRF, lockout after 10 failures (password or TOTP), RBAC permission map from docs/02 enforced server-side (default-deny guard + test walking every `/admin` route), audit log in the same transaction as each change, PII only via audited POST reveals.
- **A6/A7 Orders**: tabs mapped to the order/payment/delivery state machines, SLA countdown and risk tab, filters/search/sort with keyset cursors, detail with server-computed actions (confirm COD, packing, ready, BTS status, Yandex create/accept/cancel/refresh/returned, COD cash received, receipt, complete, cancel, refunds with Idempotency-Key), timeline + internal notes, CSV export, manual phone order through the real checkout transaction.
- **A11 Products / A14 Promo / A15 Reviews**: product editor (variants, images with magic-byte upload, SEO, keywords, relations), MoySklad field locks, IKPU and price ≥ 1 so'm guards for ACTIVE, slug change → 301 redirects; promo codes with margin guard and usage stats; review moderation, replies and before/after gallery.
- **A4/A5 Customers**: segments, filters, 360 view (KPIs from payments, timeline, consents, notes, tags), masked by default, CSV export (Owner), data export, erase with legal record retention.
- **A16 Settings**: store/legal info, delivery zones + rules + returns with a live storefront-promise preview, versioned saves; staff and audit pages.
- **A10 Integrations hub** (launch-kit readiness, masked secrets, test/connect/disconnect, secret callback URLs Owner-only) and **A13 MoySklad**: catalog/price/stock pull (hourly + stock poll + webhooks), kits from components, order push with counterparty lookup and status mirror, stock-hold hand-over to the MoySklad reserve, sync log, admin page. Runbook: `docs/runbooks/moysklad.md`.

### Verified
- contracts 107, api 206 unit + 307 integration (Testcontainers; incl. admin-rbac 63, admin-orders, admin-products/promo/reviews, admin-customers/settings/integrations, moysklad 20 against a gzip-only fake MoySklad server), admin 8 component; admin e2e 16/16 (owner login + TOTP, invites, role-filtered nav, order flow COD→complete, Warehouse limits, product create/activate/edit → storefront, promo applies in cart, delivery price → storefront quote, PII reveal → audit, Manager can't touch keys, MoySklad sync now → log).
- Phase 3 acceptance: each role sees only permitted actions (RBAC integration tests per role + e2e nav); MoySklad sync against the fake: product/price/stock pull, order push, webhook handling, log; all admin lists filter/paginate server-side.

### Independent review — fixed
High: MoySklad price 0 no longer imported (products could sell for free); stock holds always end (released when MoySklad owns stock, consumed otherwise at hand-over; MoySklad reserve dropped on every cancel/return). Medium: TOTP lockout survives re-login; empty/partial stock reports and non-UZS prices ignored; MoySklad-linked variants' SKU/active and linked drafts' delete refused; active price ≥ 1 so'm. Low: MoySklad lock lease renewal, counterparty reuse, idempotency keys kept after commit, Warehouse phone search, pickup delivery via the state machine, one LTV definition, Yandex cancel without HTTP inside the lock (Phase 2 follow-up closed), https-only links, orphaned photos, home hero after slug change, exact promo times, erase also clears photos/notes/chat ids and lists external copies, clearable integration fields, admin error page, bounded 360 view, CSV phones as digits.

### Not verified / owner input
- MoySklad protocol from open-source clients + a Lognex-generated SDK (doc host unreachable): open questions 60–69 (incl. q.68 personal data in a Russian service). Needs: admin-rights API token, UZS account, price type/store/organization, IKPU attribute name, state names, matching SKUs, public HTTPS API URL for webhooks.
- SMS templates for order cancellation / phone-order confirmation (none sent yet); real 17-digit IKPU for all seed variants; storefront doesn't read admin SEO overrides yet and refreshes within 30–60 s (Phase 4); production `REVOKE UPDATE, DELETE ON "AuditLog"`.

## Phase 2 — Payments, fiscal, delivery, SMS, auth (done, 2026-10-27)

### Built (API)
- **Payme Merchant API** (JSON-RPC, all methods incl. ChangePassword, 12 h timeout, fiscal `detail`, refunds via cancel) and **Click SHOP API** (prepare/complete, md5 sign) — contract tests for every documented error code; duplicate/concurrent callbacks never double-pay. Runbook: `docs/runbooks/payments.md`.
- **Eskiz SMS**: token cache + single-flight login, 401 re-login, no blind resend; delivery-status callback protected by a per-install secret path. **Telegram login** (Login Widget hash check, 24 h freshness) + linking Telegram to a phone account; customers may exist without a phone. Runbook: `docs/runbooks/messaging-and-fiscal.md`.
- **Fiscal**: manual receipt provider; an order can be COMPLETED only with receipt proof (manual receipt, payment receipt URL, or Payme fiscal detail).
- **BTS** manual mode (operator waybill + statuses drive order transitions and SMS) until BTS shares API docs.
- **Yandex Delivery**: estimate-only claim creation, explicit paid accept (refused in test mode — no sandbox), idempotent request ids, cancel with fee check, per-minute sync job with leases/backoff, optional unsigned callback → re-read, courier info in tracking (phone only for the order owner), optional live quote (off). Runbook: `docs/runbooks/delivery.md`.
- Delivery status state machine in `@forest/contracts`; reservations/expiry and SLA cut-off from Phase 1.

### Built (storefront)
- Telegram Login Widget on `/kirish` and "Telegram'ni bog'lash" in Kabinet → Sozlamalar (only when `auth.telegramBot` is set; script on idle/interaction, `onauth` → API, shared post-login path with OTP); Telegram-only (phone-less) customers in the cabinet.
- Tracking/order pages: courier card (name, car, plate, ETA, call link with extension for the owner, masked number + login hint otherwise), carrier history with API labels, BTS track number + waiting branch, address change disabled with the reason once the carrier has the address.
- Checkout passes the geolocation pin to `/cart/quote` and `/cart?zone=` (live quote where enabled).

### Verified
- CI green on GitHub incl. Playwright e2e on the docker-compose production images (run 27).
- contracts 80, api 113 unit + 136 integration (Testcontainers), web 19 component, ui 8; storefront e2e on a production build 53 passed / 1 skipped (incl. `phase2.spec.ts` 8/8: Telegram-only cabinet, courier card owner vs masked, BTS track/branch, widget hidden without a bot).
- Phase 2 acceptance: Payme/Click contract tests for every documented error code; duplicate/concurrent webhooks never double-pay; reservation expiry releases stock; SLA cut-off unit tests with a fixed clock.

### Independent review — fixed
High: no cancel/full refund while a courier has or is fetching the parcel. Medium: missed-pickup and return SMS/status handling, address change under the order lock (old pin dropped, pending claim locks it), stock released on RETURNED/CANCELLED, live-quote isolation (own breaker, no retries, per-IP limit), message templates backfilled by a data migration. Low: Yandex accept without HTTP inside the locking transaction, Eskiz token masked in logs, early Eskiz callbacks parked, Telegram stub merge (cart/consents, sessions revoked), polling stops for abandoned claims + `markReturned`, courier phone reset on performer change, repeated `claim_id`.
Not done on purpose: Telegram widget replay protection (may block legitimate re-logins; unverifiable without Telegram docs); Yandex `cancelClaim` still calls Yandex inside its transaction (follow-up).

### Not verified / owner input
- Official doc hosts (Payme, Click, Eskiz, Telegram, Yandex) are unreachable from this environment; protocols come from official GitHub templates (Payme/Click) or ≥ 2 cross-checked open-source clients (Eskiz, Telegram, Yandex). Open questions 28–59 list every unverified point. Credentials, sandbox runs, Eskiz template approval, Yandex contract + warehouse coordinates, Telegram bot + `/setdomain`, COD receipt process are needed from the owner.

## Phase 1 — Storefront (2026-10-26)

### Built
- **API (NestJS):** anonymous cookie cart + merge on login, live pricing via the shared engine, delivery quote per zone, idempotent checkout (one transaction: customer lock, promo, COD limit, IKPU snapshots, atomic stock reservation, consents), order lifecycle service (state machines + OrderEvent), order/tracking read models with PII masking, reservation expiry and 15-min payment reminder jobs; customer OTP auth (sessions in Redis, rotation), `/me` (orders, addresses, favourites, consents, export/deletion request), leads + waitlist, search (pg_trgm, Latin↔Cyrillic, synonyms, zero-result log), CMS/legal content blocks, SEO feeds (sitemap data, redirects, 404 log), product reviews list, admin-managed home media.
- **Storefront (Next.js 15, UZ/RU, 1440 + 390):** layout (top bar, header, footer, consent banner, exit-intent lead popup, Telegram/cart bars), Home, Catalog (filters, sort, `?page=`), Product (gallery, variants, buy box, calculator, waitlist, reviews), Search, Cart, Checkout (COD + fake Payme/Click), fake-pay, Order received, Tracking `/t/<token>` (order language), Login (OTP), Cabinet (orders, addresses, favourites, notifications, settings), Legal pages (draft notice), edge states, sitemap.xml/robots.txt, JSON-LD, noindex on private pages.
- **packages:** `@forest/contracts/core` zod-free entry for browser bundles; `@forest/ui` Rating, Stepper, BeforeAfter.

### Verified
- CI green on GitHub incl. Playwright e2e on the docker-compose production images (run 19).
- Locally against a production build: e2e 43/43 storefront tests (desktop + 390; acceptance flow home → catalog → filter → product → calculator → cart → SALOM10 → COD → order → tracking; fake Payme/Click; OTP login → cabinet; RU; legal; edge states; `[placeholder]` guard).
- API: 88 integration (Testcontainers) + 53 unit; contracts 58 (94.7 % lines); ui 8.
- Lighthouse mobile (production build, median of 5): Home 91 / 100 / 100 / 100, Catalog 91 / 98 / 100 / 100, Product **89** / 96 / 100 / 100 (perf / a11y / BP / SEO). Sandbox runs vary ±6; re-measure with PageSpeed Insights after deploy.
- First-load JS: Home 145 kB, Catalog 156 kB, Product 150 kB (budget 170).
- Visual comparison of every page at 1440/390 with `design/screens` (screenshots reviewed); deviations listed in `apps/web/README.md` / below.

### Independent review — fixed
High: provider resolved before the order is written; cancelled orders no longer burn promo limits; checkout rate limits + open-COD cap. Medium: real `fr_aid` device rule, OTP per-phone caps + daily lock, tracking link in SMS bodies, pay-again race (lock order). Low: paid status vs retries, one checkout per cart, cart leak across customers, consent dedupe, FREE_SHIPPING vs kits, payment reminder, zombie orders on reseed, dev endpoints in production. Plus production-only bugs found while closing the phase: 500s on dynamic pages, CI typecheck, web image baking `localhost` API (Turbo env + Docker build arg), AVIF encoder hang, client IP behind Cloudflare.

### Mocked / not yet real
- All integrations run on fake providers locally; Payme/Click real adapters exist (Phase 2) but need credentials.
- Product photos, hero before/after and lead photo are stock placeholders; IKPU codes are placeholders; app icon is derived from the logo.
- Hidden until data/API exists: reviews/ratings (no reviews yet), repeat order, courier map, "buy new" price comparison, Ilhom/Brend pages. (Telegram login and courier phone shipped in Phase 2 — shown when the bot/courier data exist.)

### Owner action needed
- Real photos (products, before/after), real prices/stock, IKPU + package codes; review RU strings in `apps/web/messages/RU_REVIEW.md`; open questions in `docs/13-open-questions.md` (incl. 28–36 for payments).

## Phase 0 — Foundation (2026-10-26)

### Built
- Monorepo: pnpm 10 + Turborepo, TS strict everywhere, ESLint 9 (incl. jsx-a11y), Prettier, husky + lint-staged + commitlint.
- `packages/contracts`: money (tiyin BigInt), UZ phone E.164 parse/format/mask, locale helpers, Latin/Cyrillic search normalization + slugify, Asia/Tashkent time, delivery promise (cut-off, same-day cap, work days), SLA state, order/payment state machines, cart pricing engine (no stacking, margin guard, gift, free shipping), paint calculator, regions, localized error codes, zod schemas (catalog, settings, content). 99 % line coverage.
- `packages/db`: full Prisma schema (+timestamptz, sequences for `F-`/`C-` numbers, pg_trgm GIN search index, BRIN on events), init migration with monthly-partitioned `Event` + partition maintenance functions, idempotent seed (8 products / 14 variants from the design, 4 categories, settings, 4 legal drafts UZ+RU, FAQ, 6 selector tiles, 17 message templates UZ+RU, SALOM10/SAVAT5/RAHMAT5, synonyms, owner account, photos uploaded to S3).
- `apps/api` (NestJS 11): env validation, Prisma/Redis/S3, pino with PII redaction, stable error codes with UZ/RU messages, `/health` `/ready`, `GET /v1/settings/public`, catalog (`categories`, filtered/faceted `products`, `products/:slug`, `bestsellers`), integrations framework (46-entry registry incl. 12-item launch kit, AES-256-GCM credential vault with key rotation and audit log, provider ports + fake adapters, resilient HTTP client with retries/circuit breaker, redacted IntegrationLog), dev-only fake outbox.
- `packages/ui`: design tokens as Tailwind v4 theme, Button/IconButton/Chip/Badge/Field/Input/PhoneInput(+998 mask)/Switch/Panel/KpiTile/Price.
- `apps/web`: Next 15 + next-intl (`/uz`, `/ru`, `/` redirect by cookie → Accept-Language → uz), self-hosted Montserrat (latin+cyrillic), foundation page rendering seeded bestsellers from the API.
- `apps/admin`: Next 15 shell (noindex, X-Frame-Options DENY) checking API readiness.
- Infra: `infra/compose.yml` (postgres 16, redis 7, SeaweedFS S3, mailpit; `apps` profile: migrate, api, web, admin, caddy), Dockerfiles (api runtime + migrate target, Next standalone), Caddyfile with security headers, `pnpm dev` one-command stack.
- CI (GitHub Actions): format, typecheck, lint, unit tests, commitlint (PRs), gitleaks, `pnpm audit`, Testcontainers integration tests, Playwright smoke (desktop + 390 px) against a production-mode build, Docker image builds.

### Verified locally
- `pnpm exec turbo run typecheck lint test` — green (contracts 53 tests, api 13 unit, ui 5).
- `pnpm --filter @forest/api test:integration` — 16 tests green (Testcontainers Postgres + Redis, migrations + seed applied).
- `pnpm build` — green; prod-mode stack + `pnpm e2e` — 10/10 smoke tests green; dev outbox returns 404 in production.
- `pnpm dev` from scratch — infra up, migrations, seed, three apps serving.

### Independent review (subagent) — fixed
Critical: web build no longer needs a live API (CI e2e/docker). High: gift promos all-or-nothing and
never stacked with kits; DB constraints/triggers for invariants 1, 2, 3, 5; dev outbox gated by
`DEV_ENDPOINTS`, fake providers refused in production, no silent fake fallback. Medium: unaccent,
daily partition job + UTC bounds + DEFAULT-partition alert, `onSale=false`, `Vary: Accept-Language`,
SMS bodies/URL tokens/phones redacted in logs, BTS work-day roll, e2e now runs on compose images,
pinned infra images. Low: rounding, compact format, refused-delivery transition, ZodPipe codes,
parametrized DB password.

### Mocked / not yet real
- Every integration runs on its fake adapter (no external calls). Real adapters arrive in Phase 2 (Payme, Click, Yandex, BTS, Eskiz, fiscal) and Phase 3+ (MoySklad, Telegram, ads, SEO tools).
- IKPU codes are a flagged all-zero placeholder; prices/stock are design samples; photos are stock placeholders.
- Docker images could not be built inside this sandbox (no network in containers) — validated by the CI `docker` job; the api runtime bundle (`pnpm deploy` + bundled Prisma engines) was validated on the host.

### Owner action needed
See `docs/13-open-questions.md` (new items 21–27 added in Phase 0).
