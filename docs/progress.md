# Progress

Current phase: **Phase 1 — done** (one acceptance item open: Product Lighthouse perf median 89 in the sandbox) · **Phase 2 — API done**, storefront wiring in progress.

| Phase | Status | Notes |
|---|---|---|
| 0 Foundation | done | see report below |
| 1 Storefront | done | see report below; Product perf 89 (target 90) |
| 2 Payments/delivery/SMS/auth | in progress | API done (Payme, Click, Eskiz, Telegram login, fiscal manual, BTS manual, Yandex Delivery); storefront wiring next |
| 3 Admin core | pending | |
| 4 Analytics/heatmaps/audiences/SEO | pending | |
| 5 Bot/automations/content | pending | |
| 6 Hardening & launch | pending | |

## Phase 2 — Payments, fiscal, delivery, SMS, auth (in progress, 2026-10-27)

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
- contracts 60, api 96 unit + 120 integration (Testcontainers), ui 8 — all green.

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
