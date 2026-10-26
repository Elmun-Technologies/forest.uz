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
Dev-only: `GET /v1/dev/outbox` lists SMS/Telegram captured by fake providers (OTP codes); 404 unless `DEV_ENDPOINTS=true` and `PROVIDERS_MODE=fake`.
Jobs: BullMQ queue `maintenance` → `events.partitions.ensure` daily 03:10 Tashkent (+ on boot).
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
- Eskiz SMS texts must be pre-approved templates; dynamic content only in allowed slots.
- Uzbek apostrophes (o', g') break naive slugify/search — use the shared `slugify` and search normalization (Latin↔Cyrillic, ʻ’' variants).
- Montserrat must include **cyrillic** subset for RU.
- Never render `[placeholder]` text or fake ratings; hide blocks without real data.
- Webhook handlers must be idempotent; return 200 quickly and process async.
- Time zone: Asia/Tashkent for cut-offs and SLA; tests with fixed clock.
- Don't cache personalized HTML/API at Cloudflare.
- Never put `NODE_ENV` in `.env`: `next build` with NODE_ENV=development fails ("<Html> should not be imported…").
- Running `pnpm install`/`turbo build` while `pnpm dev` runs can crash dev servers (packages rebuilt/relinked) — restart `pnpm dev`.
- Don't `pkill -f <pattern>` with a pattern that appears in your own shell command (kills the shell); use `pkill -f "next-serve[r]"`.
- Write NBSP as `'\u00A0'` in source (literal NBSP fails eslint no-irregular-whitespace). Money formatting already uses NBSP separators — tests compare with `\u00A0`.
- Prisma: after schema edits run `pnpm db:generate` (client lives in packages/db/generated). Partition tables are in schema `event_parts` — never move them to `public`.
- API integration test files share one seeded Testcontainers DB (settings, Integration rows) and must run sequentially: Vitest 3 ignores `fileParallelism` inside `projects`, so `apps/api/vitest.config.ts` also sets `poolOptions.forks.singleFork`. Tests that change shared rows restore them in `afterAll`.
- Client IP (OTP/lead rate limits) = Express `trust proxy 1` → the last `X-Forwarded-For` hop. Correct only because Caddy overwrites XFF and Next's `/api` rewrite passes it through: never publish web :3000 or api :4000 beyond 127.0.0.1. Behind Cloudflare, read `CF-Connecting-IP` from trusted CF ranges (Phase 6).
- Docker Hub may rate-limit; `mirror.gcr.io/library/<image>` is a drop-in mirror.
- Design sample data contradicts itself (e.g. 550 200 checkout total vs 500 000 free-delivery rule): docs/02 rules win; keep logic in settings.

## 18. TODO / status
Track phases in `docs/progress.md`. Current phase: **Phase 1 (Storefront) — all pages built, closing (Lighthouse, review, report)**; Phase 2 started (Payme/Click done).

## 19. Known limitations
BTS API docs unknown (manual mode fallback); COD fiscal provider TBD; real content/prices pending (see `docs/13-open-questions.md`).

## 20. Future improvements
Marketplace (v2), installments (Uzum Nasiya, Alif), Uzum Market feed, ClickHouse for events at scale, native app / Telegram Mini App, B2B pricing for craftsmen.
