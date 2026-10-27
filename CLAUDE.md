# CLAUDE.md — Forest

Single source of truth for this project. **Read fully at the start of every session. Update it whenever a decision, convention, command or pitfall changes.** Detailed specs live in `docs/`; this file summarizes and links.

## 1. Overview
Forest — premium European furniture & fabric paints e-commerce for Uzbekistan (UZ/RU). Storefront + admin panel (first-party analytics, heatmaps, CRM, SEO, integrations hub) + Telegram service bot. Single seller now, marketplace-ready.
- Product spec: `docs/01-product-requirements.md`
- Business rules: `docs/02-business-rules.md`
- Design: `design/README.md` (screens PNG + source), tokens in `docs/11-design-system.md`

## 2. Goals
Capture every visitor (lead or purchase), deliver 12 h Tashkent / 24 h Uzbekistan, own all data (no GA/Metrika dependency), admin controls everything (SEO codes, integrations, content), Lighthouse mobile ≥ 90.

## 3. Tech stack
pnpm 10 + Turborepo · Node 22 · TypeScript 5.9 strict · Next.js 15.5 App Router (web, admin) · React 19 · NestJS 11 (api, Express) · PostgreSQL 16 + Prisma 6.19 · Redis 7 + BullMQ · S3-compatible storage (dev: SeaweedFS) · Tailwind v4 + Radix · next-intl 4 · zod 4 (`packages/contracts`) · grammY (Telegram) · rrweb · Vitest 3, Playwright 1.63, Testcontainers 11 · Docker Compose + Caddy · Sentry/GlitchTip · pino.
Versions are pinned to proven majors on purpose (see decisions); upgrade deliberately, not opportunistically.

## 4. Folder structure
```
apps/web        storefront          :3000
apps/admin      admin panel         :3001
apps/api        NestJS api/webhooks/jobs/bot :4000
packages/db     prisma schema, migrations, seed; client generated into packages/db/generated (gitignored)
packages/contracts  zod schemas, DTO types + pure domain core (money, phone, SLA, state machine, pricing, calculator)
packages/ui     tokens (theme.css), components (source, transpiled by Next)
packages/tracker    first-party analytics script (Phase 4, not created yet)
packages/config     eslint/tsconfig presets
e2e/            Playwright (desktop 1440 + mobile 390 projects)
infra/          compose.yml, docker/*.Dockerfile, Caddyfile, seaweedfs/s3.json (dev-only creds)
scripts/        dev.mjs (one-command local stack)
design/         design reference (read-only)
docs/           specs, progress.md, runbooks/, handoff/ (original prompt + Uzbek readme)
```

## 5. Commands
```
pnpm i
cp .env.example .env   # optional: pnpm dev creates it and generates local secrets
pnpm dev               # infra (compose) → build contracts/db → migrate deploy → seed → api:4000 web:3000 admin:3001 (watch)
pnpm infra:up | infra:down
pnpm db:migrate        # prisma migrate dev (new migration from schema changes)
pnpm db:deploy         # apply migrations
pnpm db:seed           # idempotent; `pnpm --filter @forest/db seed -- --force` overwrites catalog/content
pnpm db:reset          # drop + re-migrate (dev only)
pnpm test              # unit tests (all packages)
pnpm test:integration  # api integration tests (Testcontainers: needs docker)
pnpm e2e               # Playwright smoke (needs the stack running: pnpm dev, or prod-mode as in CI)
pnpm lint && pnpm typecheck && pnpm format:check
pnpm build             # production build of everything
docker compose -f infra/compose.yml --profile apps up -d --build   # prod-like stack (migrate → api, web, admin, caddy)
```
Dev-only (404 unless `DEV_ENDPOINTS=true` and `PROVIDERS_MODE=fake`, guard `common/dev-endpoints.ts`): `GET /v1/dev/outbox` (SMS/Telegram captured by fake providers, OTP codes), `POST /v1/dev/fake-pay`, `POST /v1/dev/telegram-login` (Telegram-only customer without the widget hash), `POST /v1/dev/shipment` (put an order's shipment/courier into a state for tracking UI tests).
Jobs: BullMQ queue `maintenance` → `events.partitions.ensure` daily 03:10 Tashkent (+ on boot); queue `orders` → `orders.reservations.expire` and `orders.payment.remind` every minute; queue `delivery` → `delivery.shipments.sync` every minute (active Yandex claims) + `delivery.shipment.refresh` (one claim, enqueued by the Yandex callback).
(Keep this list true — update when scripts change.)

## 6. Architecture decisions (rationale in `docs/03-architecture.md`)
Monorepo · separate admin app/domain · NestJS modules per domain · Postgres-first analytics (partitioned events) + rrweb replays in object storage · adapter pattern + fake providers for every integration · integration credentials encrypted in DB, edited by Owner in admin · zod contracts shared · UZ hosting for PII.
**Log new decisions here** (date — decision — why):
- 2026-10-26 — initial architecture from handoff — see docs/03.
- 2026-10-26 — Pin proven majors (Next 15.5, Nest 11, Prisma 6.19, TS 5.9, zod 4, Vitest 3) instead of the newest (Next 16, Nest 12, Prisma 7/8, TS 7) — docs specify Next 15/Prisma 5.x schema; newest majors change build/ORM APIs and add risk without benefit for MVP.
- 2026-10-26 — Dev object storage = SeaweedFS S3 (MinIO no longer publishes public images). Code uses the generic S3 API, so prod can be any UZ-hosted S3 provider.
- 2026-10-26 — Pure domain logic (money, SLA/cut-off, order/payment state machines, pricing/promo engine, calculator) lives in `packages/contracts` so web, admin and api share one tested implementation.
- 2026-10-26 — Promo "no stacking with kit discount, best one applies" = code computed on the compare-at base minus kit savings already given; rejected with PROMO_NO_BENEFIT if kit is better. Margin guard caps kit+code at `promo.rules.maxDiscountPct` of compare-at base. Free-shipping threshold uses merchandise total after discount.
- 2026-10-26 — Delivery promise (Tashkent express): clock start before cut-off → min(start+12 h, same-day `sameDayEnd` 23:59); at/after cut-off or non-working day → next working day `afterCutoffBy` (12:00). All values in `delivery.zones` settings.
- 2026-10-26 — Kit (BUNDLE) availability = the kit SKU's own stock (pre-packed / MoySklad bundle stock, which MoySklad itself computes as min of components). We reserve only the kit SKU.
- 2026-10-26 — Event table partitioned monthly; partitions live in schema `event_parts` so Prisma (managing `public`) never sees drift. `ensure_event_partitions()` / `drop_old_event_partitions()` SQL functions; default partition is a safety net.
- 2026-10-26 — All timestamps `timestamptz(3)`; human numbers via sequences (`F-10001…`, `C-10001…`) as DB defaults.
- 2026-10-26 — Prisma client generated into `packages/db/generated` (musl + debian engines) so `pnpm deploy`ed images need no runtime `prisma generate`.
- 2026-10-26 — Montserrat self-hosted via `@fontsource-variable/montserrat` (latin+cyrillic unicode-range) instead of next/font/google: builds don't depend on Google, no third-party font request.
- 2026-10-26 — Catalog listing filters/facets in memory over active products (catalog is hundreds of SKUs). Revisit if > few thousand products.
- 2026-10-26 — CMS/legal body = structured blocks (`contentBlockSchema`) with `{store.*}` variables; blocks whose variables are missing are hidden, so legal drafts never render `[placeholder]` text.
- 2026-10-26 — Providers: fakes only when `PROVIDERS_MODE=fake`; in sandbox/live an unconnected/unimplemented provider throws INTEGRATION_NOT_CONFIGURED (never silently fake). Production refuses fake mode unless `ALLOW_FAKE_PROVIDERS=true` (demos/CI). `/v1/dev/outbox` needs `DEV_ENDPOINTS=true` + fake mode.
- 2026-10-26 — DB-level invariants (raw SQL migration): CHECKs on stock/qty/totals/rating, triggers for one PAID payment per order and IKPU-before-ACTIVE (triggers, not partial indexes, so Prisma sees no drift).
- 2026-10-26 — Storefront pages are never prerendered at build (`generateStaticParams` returns []): they render on first request and are cached by fetch revalidation, so builds don't need a live API.
- 2026-10-26 — Browser → API via the storefront rewrite `/api/*` → `API_INTERNAL_URL/v1/*` so cookies (`fr_session`, `fr_cart`) are first-party; RSC calls the API directly and forwards the Cookie header. Sessions: opaque id in Redis (`sess:<id>`), 90 d sliding, rotated on login (`apps/api/src/common/session.ts`).
- 2026-10-26 — Catalog keeps `?page=n` pagination (crawlable, docs/01) instead of cursors; cursors are for admin/API lists.
- 2026-10-26 — Legal draft pages are published (Payme/Click onboarding needs a public offer) but show a "draft, lawyer review pending" notice and hide rows with missing company data until `store.legal` is complete.
- 2026-10-26 — Integration credentials: AES-256-GCM envelope `[v1][keyId:4][iv:12][tag:16][ct]`, AAD = integration key; key rotation via previous keys. Blank secret inputs keep the stored value.
- 2026-10-26 — Storefront frames as route groups: `[locale]/(shop)` (header/footer) and `[locale]/(flow)` (checkout, login, fake-pay with their own minimal headers). Cart's compact mobile header hides the global one via CSS `:has([data-mobile-flow])` — no JS.
- 2026-10-26 — `/t/<token>` stays locale-less for SMS: middleware rewrites to `/{locale}/t/<token>` (fr_locale cookie → the order's language via `/track/:token` → Accept-Language).
- 2026-10-26 — `/fake-pay` is gated by probing the API's fake callback (ORDER_NOT_FOUND = fake mode) rather than a build flag; its `return` param is ignored (no open redirect).
- 2026-10-26 — Unknown/removed URLs go through `notFoundWithRedirect` (admin redirect lookup → else 404 logged for the SEO center).
- 2026-10-26 — `@forest/contracts/core` = zod-free entry (domain helpers, enums, types). Client components import values only from `/core`; the main entry (zod schemas, ~27 KB gz) is for api/server code. Guarded by `core.test.ts`. Keeps product-page first-load JS under the 170 KB budget.
- 2026-10-26 — Storefront marks identified visitors with a readable `fr_ident=1` cookie (set by middleware when the httpOnly `fr_session` exists) so client code can personalise without making pages uncacheable. It carries no identity.
- 2026-10-26 — Storefront hides nav/footer links to pages that don't exist yet (`pageReady` in `apps/web/src/config/site.ts`) and hides any block without real data (reviews, gallery, ratings) instead of rendering design sample text.
- 2026-10-26 — Payme/Click: protocol source of truth = the providers' official GitHub templates (pinned commits in `docs/runbooks/payments.md`), since their doc sites are unreachable from dev. Account value everywhere = `Order.number` (`F-10482`): Payme `account.order_id`, Click `merchant_trans_id`. Click `merchant_prepare_id`/`merchant_confirm_id` = the order number's digits (Click expects an integer; our ids are cuids).
- 2026-10-26 — One `Payment` row per provider transaction (`providerTxnId` unique per method). The checkout's PENDING row is bound to the first Payme/Click transaction; a later attempt after a cancelled/failed one gets a new row, so `CheckTransaction`/`GetStatement` still report old transactions exactly. Payme state lives in `providerState` (1/2/-1/-2), Click in `providerState` 0 prepared / 1 completed / -1 cancelled; Payme times in `providerData` (ms).
- 2026-10-26 — Webhooks authenticate only against the encrypted credentials of a CONNECTED integration (Payme Basic `Paycom:<key>` — test key in `mode=test`; Click md5 `sign_string`), independent of `PROVIDERS_MODE`. Payme `ChangePassword` rewrites the stored key (audited).
- 2026-10-26 — Payme cancel of a created transaction (-1) marks the payment FAILED but keeps the order NEW (customer may retry until the reservation expires) — unlike the template, which cancels the order. Cancel of a performed transaction (-2) = refund: payment REFUNDED + `Refund` row; the order is cancelled and stock released if not yet handed to a courier, refused (-31007) once handed over/delivered. Payme refunds are provider-initiated (cabinet → CancelTransaction); Click/COD refunds are recorded manually (`OrderLifecycleService.recordManualRefund`).
- 2026-10-26 — Storefront CSS is inlined (`experimental.inlineCss`). With a `<link>` stylesheet, the first frame often lands after the JS chunks start executing; Chrome's paint holding then keeps the page blank until ~1.25 s (seen in ~60 % of mobile Lighthouse runs, LCP +1.3 s). Inline: ~1 in 30. Cost: ~14 KB gz more HTML (Next also copies the CSS into the RSC payload). Don't preload the web font: it makes the stall more frequent (11/15 runs).
- 2026-10-26 — Metadata is never streamed (`htmlLimitedBots: /.*/`): title/description/canonical are always in `<head>` (Lighthouse SEO failed `meta-description` on dynamic pages, where Next streams metadata into `<body>`).
- 2026-10-26 — next-intl messages are precompiled at build time (`experimental.messages.precompile` in `next.config.ts`): the browser gets the format-only runtime, not the ICU parser (−9 KB first-load JS per route). Messages must stay plain strings (no arrays/objects), as the loader enforces. Enabled only when `NODE_ENV=production` (`next build`): on Next 15 the loader is webpack-only and `next dev --turbopack` refuses it.
- 2026-10-26 — Link prefetch: storefront chrome and secondary links (header logo/search/account/cart, locale switch, footer, legal/consent, breadcrumbs) use `prefetch={false}`; viewport prefetch is kept only on the primary browse path (CTAs, category chips, product cards). Chrome prefetches fetched full static routes (home, cart, search, privacy) during page load on every page.
- 2026-10-26 — No `not-found.tsx` at the `[locale]` level: Next serialises every ancestor segment's not-found element into each page's RSC payload, and that one wrapped the whole shop chrome (header/footer/popup shipped twice). The flow 404 lives in `(flow)/fake-pay/not-found.tsx`.
- 2026-10-26 — Non-urgent startup work (first localStorage/sessionStorage/cookie reads: favourites, lead-popup suppression) runs via `onIdle` (`apps/web/src/lib/idle.ts`) or on demand, never in a mount effect: the first storage access is a synchronous round-trip to the browser and lengthens the hydration commit.
- 2026-10-26 — Checkout resolves the online payment provider **before** the order transaction (unavailable → `PAYMENT_METHOD_UNAVAILABLE`, nothing written). If only the checkout link fails after commit, the order is still returned (idempotent response stored) with the order page as `next` → "pay again". Why: an orphaned order would hold stock and burn the promo with no way back for the customer.
- 2026-10-26 — Promo usage counts (usage limit, per customer, per device) ignore redemptions whose order is CANCELLED; the redemption rows stay as history. Why: an abandoned unpaid order must not burn SALOM10 forever.
- 2026-10-26 — Checkout abuse limits (`CHECKOUT_POLICY` in `commerce/checkout.service.ts`, like `OTP_POLICY`): 10/min per IP (docs/05), 5/h per phone, ≤ 2 open NEW COD orders per phone (`CHECKOUT_LIMITED` / `COD_OPEN_ORDERS_LIMIT`). Why: COD holds stock 24 h on an unverified phone.
- 2026-10-26 — Device fingerprint for first-order promos = sha256 of `fr_aid`, a random httpOnly 400-day visitor cookie the API sets on any cart write when missing (`SessionService.ensureVisitorId`).
- 2026-10-26 — OTP per-phone caps on top of 1/60 s and 5/h per IP: 5 sends/h, 10 sends/day; 15 failed verifies/day → `OTP_LOCKED` (verify and send) until the window ends. Codes stay 4 digits (design has 4 cells).
- 2026-10-26 — Order SMS carry `{link}` (tracking) in the body, not only in Telegram buttons; COD operator confirmation sends `order_confirmed` (not `order_paid`). Unpaid online orders get one `payment_reminder` (orders queue job `orders.payment.remind`, `delivery.rules.paymentReminderMinutes`) with the order page link; idempotent via an `OrderEvent` `PAYMENT_REMINDER` written before sending.
- 2026-10-26 — Lock order everywhere is Order row → Payment row: `transition()` locks the order row itself; "pay again" runs in one transaction under the order lock and never modifies a payment row that already has a `providerTxnId`. When a payment becomes PAID, sibling PENDING rows of the order become EXPIRED; the displayed payment status prefers PAID/REFUNDED/PARTIALLY_REFUNDED rows.
- 2026-10-26 — A cart is converted by exactly one checkout (conditional `ACTIVE → CONVERTED` inside the order transaction, else `CART_EMPTY`). A cookie cart is used with a session only if it is anonymous or the session customer's.
- 2026-10-26 — FREE_SHIPPING codes don't apply to carts with kit savings (`PROMO_NO_BENEFIT`), like GIFT — docs/02 "no stacking with kit discount".
- 2026-10-26 — `DEV_ENDPOINTS=true` with `NODE_ENV=production` requires `ALLOW_FAKE_PROVIDERS=true` (CI/demos) and logs a startup warning: the dev outbox exposes OTP codes.
- 2026-10-27 — Telegram Login = the official widget (`telegram-widget.js?22`, `data-onauth`, never the redirect mode), rendered only when `settings.auth.telegramBot` is set and only on `/kirish` and Kabinet → Sozlamalar. The script is injected on idle (`onIdle`) or on the first pointer/focus on its slot, into a fixed-height slot (no layout shift); load failure shows an inline message and OTP stays usable. Why: Lighthouse budget and "no third-party JS on other pages"; the widget is a cross-origin iframe, so the design's outlined "Telegram orqali kirish" button is replaced by Telegram's own button under the "yoki" divider.
- 2026-10-27 — OTP and Telegram logins share one post-login step (`useAfterLogin`: favourites merge → cart refresh → safe `next` → `router.refresh()` so the middleware sets `fr_ident`). Why: one path to test, no drift between login methods.
- 2026-10-27 — Courier/carrier data has one source, `TrackingDto` (`GET /track/<token>`). The order page loads it (token from `trackingUrl`) only once the carrier is involved (`deliveryStatus` ≠ NOT_CREATED/CREATED), and shows the same `CourierCard`. BTS branch = `place` of the latest `AT_BRANCH` history entry (the DTO has no branch field). The `tel:` link is rendered only for an unmasked number (no `*`); the extension is shown next to it and dialled as `tel:<phone>,<ext>`. Why: `OrderPublicDto` has no courier fields and the API already decides owner vs masked.
- 2026-10-27 — When `canChangeAddress` is false on an order that is not yet with the courier, the address button is shown disabled with the reason (carrier already has the address → call the operator/bot); after hand-over it is hidden. Why: the API's ADDRESS_LOCKED rule (live claim) is invisible to customers otherwise.
- 2026-10-27 — Checkout passes the geolocation pin (when granted) to `/cart/quote` as `lat`/`lng`; the zone price stays the default and nothing else changes without a pin. No maps SDK.
- 2026-10-27 — Eskiz/Telegram/BTS/fiscal protocol sources = open-source SDKs + the Eskiz Postman collection export, cross-checked (pinned in `docs/runbooks/messaging-and-fiscal.md`), since the providers' doc hosts are unreachable from dev. Unverified points are open questions, not guesses in code.
- 2026-10-27 — Eskiz bearer token cached in Redis (`eskiz:token:<sha(email)>`, TTL from the JWT `exp`, else 24 h), renewed 1 h before expiry and once on HTTP 401; one login at a time (in-process promise + Redis `SET NX` lock) so concurrent sends never stampede `/auth/login`. Login/send are form-encoded (Postman collection).
- 2026-10-27 — Eskiz delivery callbacks are unsigned (no signature in any source): `callback_url` = `/v1/webhooks/eskiz/<callbackToken>`, a 32-byte random per-install token generated on connect and stored encrypted with the credentials; constant-time compare, unknown token → 404. Status only moves forward (DELIVERED/FAILED are final); unknown ids are ignored with 200.
- 2026-10-27 — `Customer.phone` is nullable: a Telegram-login customer may have no phone. Checkout still identifies the buyer by the body's phone (orders belong to that phone's customer); an unverified phone is never attached to an account. `POST /me/telegram/link` (OTP session) attaches the Telegram id; if a phone-less Telegram-only customer holds it, that stub is absorbed (addresses + favourites move, stub erased); any other holder → `TELEGRAM_ALREADY_LINKED`.
- 2026-10-27 — Telegram login (widget hash, `docs/runbooks/messaging-and-fiscal.md`) verifies against the CONNECTED `telegram` integration's bot token regardless of `PROVIDERS_MODE` (inbound auth, like webhooks); all received fields go into the data-check-string, values with line feeds are rejected, `auth_date` ≤ 24 h old and ≤ 5 min in the future; 10/min per IP. Public settings expose `auth.telegramBot` only when the integration is connected.
- 2026-10-27 — Fiscal rule: an order can become COMPLETED only with fiscal evidence for the sale — a `FiscalReceipt` row (manual operator entry or OFD), a PAID payment's `fiscalReceiptUrl`, or a PAID Payme payment created while the cashbox sent receipt `detail` (Payme fiscalizes; flagged `fiscalDetail` in `providerData` at CreateTransaction). Click needs a manual entry until q.34 is answered. DELIVERED is not gated (COD receipts are issued at the door and entered afterwards). Enforced in `OrderLifecycleService.transition` → `FISCAL_RECEIPT_REQUIRED`.
- 2026-10-27 — Delivery status is a forward-only state machine in `@forest/contracts` (`assertDeliveryTransition`; FAILED may be retried, DELIVERED/RETURNED final). BTS runs in manual mode (no API docs, q.11): the operator sets track number/branch/status via `ManualShipmentService.setManualShipment`; the order is walked through the intermediate fulfilment statuses (PICKED_UP+ ⇒ HANDED_TO_COURIER, DELIVERED ⇒ DELIVERED, RETURNED ⇒ RETURNED) with one OrderEvent each, and the matching service SMS is sent after commit.
- 2026-10-27 — Yandex Delivery (Express Claims API v2, `b2b.taxi.yandex.net/b2b/cargo/integration/v2`) built from the official doc pages' search snippets + three independent open-source clients (Node, Python, Go — pinned in `docs/runbooks/delivery.md`), since the doc hosts are unreachable from dev. Where sources disagree we send the field set they share (e.g. no `droppof_point`/`dropoff_point` with one destination) and list the point as an open question.
- 2026-10-27 — A Yandex claim is two explicit steps: `claims/create` (estimate only, never `auto_accept`) and `claims/accept` by staff (`YandexShipmentService.acceptClaim`, Phase 3 "Kuryer chaqirish"). There is no sandbox and an accepted claim dispatches a real paid courier, so integration `mode=test` allows quotes and claim creation but refuses accept (`DELIVERY_TEST_MODE`). `request_id` = `<shipmentId>-<attempt>`, written to the shipment before the call, so retries, timeouts and crashes reuse it and Yandex returns the same claim.
- 2026-10-27 — Yandex claim state is only ever read from `claims/info`: the BullMQ `delivery` queue polls active claims every minute (per-shipment lease via a conditional `nextSyncAt` update, backoff on errors) and the optional status callback just enqueues a refresh. Updates apply under order → shipment row locks and are ignored when the claim's `updated_ts` is older than the stored one, so overlapping runs and callbacks never double-transition or double-notify. The callback URL carries a secret `key` (HMAC-SHA256 of `APP_ENCRYPTION_KEY`), as Yandex callbacks are unsigned.
- 2026-10-27 — Yandex status → `DeliveryStatus` mapping lives in one pure function (`yandexStatusToDelivery`); order transitions go through `OrderLifecycleService` only: PICKED_UP+ ⇒ HANDED_TO_COURIER, DELIVERED ⇒ DELIVERED, returned ⇒ RETURNED; cancellations/`performer_not_found` before pickup ⇒ FAILED with the order untouched (staff may create a new claim). Customer SMS once per milestone (`order_courier`/`order_shipped`, `order_delivered`, `order_delivery_failed`), decided inside the status transaction.
- 2026-10-27 — Courier contact = Yandex's temporary forwarded number (`driver-voiceforwarding`, with ext and TTL), stored in `Shipment.courier`; the tracking page shows it only to the order owner (session customer or the browser that placed the order — `fr_ord`), masked otherwise; courier name stays first-name only.
- 2026-10-27 — Live Yandex quote is per zone (`liveQuote`, default **off**) and needs warehouse coordinates (integration fields) and the customer's pin: `check-price` result (UZS only) is cached 10 min in Redis per zone + ~11 m coordinates + weight, so cart quote and checkout charge the same; no coordinates, an error or a non-UZS answer ⇒ zone price from settings (current behaviour). No geocoding.
- 2026-10-27 — Once a Yandex claim is live, the customer can no longer change the address on the tracking page (`ADDRESS_LOCKED`): Yandex already has it. COD orders get a Yandex claim only with integration `allowCod=on` (amount written in the courier comment) — cash collection by Yandex couriers is unconfirmed (open question).

## 7. Coding standards
- TypeScript strict, no `any` (use `unknown` + zod). Small modules, SOLID, DRY, KISS; no premature abstraction except the integration adapters.
- Domain logic in services (pure where possible); controllers thin; Prisma only in repositories/services, transactions for multi-row invariants.
- Money helpers only from `packages/contracts/money.ts` (tiyin BigInt). Phone helpers from `phone.ts` (E.164).
- Localized fields via `t(localized, locale)` helper; never hardcode UI copy — `messages/uz.json`, `messages/ru.json`.
- Errors: typed `DomainError(code)` → mapped to HTTP + localized message.
- Comments explain *why*, not *what*. No dead code, no TODO without issue reference in `docs/progress.md`.
- Accessibility: semantic HTML, labels, focus-visible, keyboard support.
- Commits: Conventional Commits, logically grouped (`feat(checkout): …`, `fix(payme): …`). Never commit secrets.

## 8. Naming
- Files kebab-case; React components PascalCase; hooks `useX`; Nest `*.module.ts / *.service.ts / *.controller.ts`.
- DB: models PascalCase singular, fields camelCase, money `…Tiyin`, timestamps `…At`, booleans `is…/has…`.
- Events (analytics) snake_case (`add_to_cart`); queue jobs `domain.action` (`moysklad.order.push`).
- Routes: UZ slugs on storefront (`/katalog`, `/savat`, `/checkout`, `/kabinet`, `/t/:token`), English in admin & API.

## 9. API conventions
REST `/v1`, zod-validated, cursor pagination, stable error codes, idempotency keys on checkout/refund, signed outbound webhooks. Details: `docs/05-api.md`.

## 10. Database conventions
See `docs/04-data-model.md`: BigInt tiyin, localized JSON `{uz,ru}`, UTC timestamps, partitioned `Event`, invariants list, seed data.

## 11. Business rules (summary — full list in docs/02)
- Delivery: Tashkent Yandex ≤ 12 h (cut-off 18:00 → next day 12:00), regions BTS ≤ 24 h; free from 500 000 so'm [confirm]; all values from settings.
- Payments: Payme, Click, COD; webhook = truth; fiscal receipt with IKPU required; no card data stored.
- Stock: MoySklad master for price/stock; reserve on order (30 min online, until confirm for COD).
- Promo: no stacking, discount ≤ 15 %, one per phone/device; SALOM10 / SAVAT5 / RAHMAT5.
- Reviews: verified purchase only, moderated, photo needs consent; ≤ 3★ alerts.
- Messaging: service always, marketing ≤ 1/day, quiet hours, opt-out; SMS fallback.
- RBAC roles: Owner, Manager, Operator, Warehouse, Marketer (matrix in docs/02).
- Marketplace-ready: `sellerId` on products/shipments.

## 12. Third-party integrations
Payme (Merchant API), Click (SHOP API), Yandex Delivery, BTS, MoySklad, Eskiz SMS, Telegram Bot API, Meta Pixel+CAPI, Google Ads/Merchant, TikTok, Yandex Metrika (Direct signal only), GSC, Yandex Webmaster, Bing/IndexNow, Google Maps, Cloudflare, Claude API (AI drafts). Registry & launch kit: `docs/06-integrations.md`. **Always read current official docs before implementing a provider.**

## 13. Environment variables
See `.env.example` (no real values ever in repo). Integration credentials are NOT env vars — they're stored encrypted in DB via admin; env holds only infra + bootstrap secrets.

## 14. Testing strategy
Vitest unit (domain), Testcontainers integration (API + webhooks + jobs), Playwright e2e (desktop + 390 px mobile) + visual snapshots vs `design/screens`, contract fixtures for Payme/Click. Details: `docs/12-roadmap-and-acceptance.md`.

## 15. Deployment
Docker Compose on UZ-hosted VPS (db, redis, minio, api, web, admin, caddy) + Cloudflare in front. Staging uses sandbox credentials. Migrations run on deploy (`prisma migrate deploy` + raw SQL). Backups daily + PITR. Runbooks in `docs/runbooks/`.

## 16. Glossary (UZ → meaning)
| Term | Meaning |
|---|---|
| Bo'yoq / kraska | paint |
| To'plam | kit / bundle |
| Savat | cart |
| Buyurtma | order |
| Yetkazish | delivery |
| Olganda to'lov / Naqd | cash/card on delivery (COD) |
| Kuzatish | tracking |
| Mijoz | customer |
| Sharh | review |
| Ilhom | inspiration (content section) |
| Kabinet | customer account |
| IKPU / MXIK | national product classification code required on fiscal receipts |
| OFD / fiskal chek | fiscal data operator / fiscal receipt |
| STIR | taxpayer ID (TIN) |
| Oferta | public offer (terms of sale) |
| Namuna | sample/placeholder data in designs |
| SLA 12/24 | delivery promise 12 h Tashkent / 24 h regions |

## 17. Known pitfalls
- Payme amounts are in **tiyin**; Click amounts in **so'm** (decimal) — convert at adapter boundary only.
- Payme expects exact JSON-RPC error shapes and state codes; run their sandbox test suite. Payme/Click webhooks always answer HTTP 200 with the provider's envelope (`@HttpCode(200)`); `ApiExceptionFilter` turns any 400 on `/v1/webhooks/payme` into JSON-RPC `-32700` — never add pipes/validation to that route. Protocol notes: `docs/runbooks/payments.md`.
- MoySklad requires gzip and has strict rate limits — queue + backoff.
- Eskiz SMS texts must be pre-approved templates; dynamic content only in allowed slots. An Eskiz account in test status only sends its fixed test texts. Never retry an Eskiz send on 5xx/timeout (no idempotency → double SMS); only the 401 → re-login path retries once. Callbacks: `/v1/webhooks/eskiz/<callbackToken>` (secret generated on connect; reconnecting after a disconnect issues a new one).
- An order can't reach COMPLETED without fiscal evidence (`FISCAL_RECEIPT_REQUIRED`) — tests that close orders must record a receipt (`FiscalService.recordManualReceipt`) first.
- `Customer.phone` is nullable (Telegram-only customers): never assume a customer has a phone; order SMS go to `Order.contactPhone`.
- Uzbek apostrophes (o', g') break naive slugify/search — use the shared `slugify` and search normalization (Latin↔Cyrillic, ʻ’' variants).
- Montserrat must include **cyrillic** subset for RU.
- Never render `[placeholder]` text or fake ratings; hide blocks without real data.
- Webhook handlers must be idempotent; return 200 quickly and process async.
- Time zone: Asia/Tashkent for cut-offs and SLA; tests with fixed clock.
- Don't cache personalized HTML/API at Cloudflare.
- Next resolves `rewrites()` and edge-middleware env at **build** time: `API_INTERNAL_URL` must be a Docker build arg for the web image, not only runtime env.
- Pages under `[locale]` (layout has `generateStaticParams`) that read cookies/searchParams need `export const dynamic = 'force-dynamic'`, else 500 `DYNAMIC_SERVER_USAGE` in production only. Always run e2e against a production build before closing a phase.
- Never put `NODE_ENV` in `.env`: `next build` with NODE_ENV=development fails ("<Html> should not be imported…").
- Performance: measure Lighthouse mobile on a production build, 5 runs per page, median. Warm `/_next/image` first (a rebuild wipes `.next/cache/images`, and the first run otherwise pays for AVIF encoding). Check `observedFirstContentfulPaint` in the JSON: ~1.25 s / ~2.25 s means the paint-holding stall (see §6), not slow code. Don't add `[locale]/not-found.tsx`, a font preload, or viewport prefetch on chrome links (§6).
- Running `pnpm install`/`turbo build` while `pnpm dev` runs can crash dev servers (packages rebuilt/relinked) — restart `pnpm dev`.
- Don't `pkill -f <pattern>` with a pattern that appears in your own shell command (kills the shell); use `pkill -f "next-serve[r]"`.
- Write NBSP as `'\u00A0'` in source (literal NBSP fails eslint no-irregular-whitespace). Money formatting already uses NBSP separators — tests compare with `\u00A0`.
- Prisma: after schema edits run `pnpm db:generate` (client lives in packages/db/generated). Partition tables are in schema `event_parts` — never move them to `public`.
- API integration test files share one seeded Testcontainers DB (settings, Integration rows) and must run sequentially: Vitest 3 ignores `fileParallelism` inside `projects`, so `apps/api/vitest.config.ts` also sets `poolOptions.forks.singleFork`. Tests that change shared rows restore them in `afterAll`.
- Client IP (OTP/lead/checkout rate limits) = Express `trust proxy = TRUST_PROXY_HOPS` over `X-Forwarded-For`; Next's `/api` rewrite passes XFF through without adding a hop. 1 hop = Caddy only; 2 = Cloudflare → Caddy with Caddy `TRUSTED_PROXIES` = Cloudflare ranges (`docs/runbooks/deploy-network.md`). Never publish web :3000 / api :4000 beyond 127.0.0.1.
- Docker Hub may rate-limit; `mirror.gcr.io/library/<image>` is a drop-in mirror.
- Design sample data contradicts itself (e.g. 550 200 checkout total vs 500 000 free-delivery rule): docs/02 rules win; keep logic in settings.

## 18. TODO / status
Track phases in `docs/progress.md`. Current phase: **Phase 1 done** (Product Lighthouse perf 89 vs 90 target — re-measure after deploy); **Phase 2 — API done, storefront wiring next**: Payme/Click, Eskiz SMS, Telegram login, manual fiscal receipts, BTS manual mode, Yandex Delivery claims + sync. Provider protocols were built from cross-checked open-source clients because the official doc hosts are blocked here — see runbooks and open questions 28–59 before going live.

## 19. Known limitations
BTS API docs unknown (manual mode fallback); COD fiscal provider TBD; real content/prices pending (see `docs/13-open-questions.md`).

## 20. Future improvements
Marketplace (v2), installments (Uzum Nasiya, Alif), Uzum Market feed, ClickHouse for events at scale, native app / Telegram Mini App, B2B pricing for craftsmen.
