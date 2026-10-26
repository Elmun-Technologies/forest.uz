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
pnpm + Turborepo · Next.js 15 App Router (web, admin) · NestJS (api) · PostgreSQL 16 + Prisma · Redis 7 + BullMQ · MinIO/S3 · Tailwind v4 + Radix · next-intl · zod (`packages/contracts`) · grammY (Telegram) · rrweb · Vitest, Playwright, Testcontainers · Docker Compose + Caddy · Sentry/GlitchTip · pino.

## 4. Folder structure
```
apps/web        storefront          :3000
apps/admin      admin panel         :3001
apps/api        NestJS api/webhooks/jobs/bot :4000
packages/db     prisma schema, migrations, seed
packages/contracts  zod schemas, enums, DTO types
packages/ui     tokens, tailwind preset, components
packages/tracker    first-party analytics script
packages/config     eslint/tsconfig/prettier
infra/          compose.yml, Dockerfiles, Caddyfile
design/         design reference (read-only)
docs/           specs, progress.md, runbooks/
```

## 5. Commands
```
pnpm i
cp .env.example .env
pnpm dev            # docker compose infra + all apps in watch mode
pnpm db:migrate     # prisma migrate dev + raw SQL
pnpm db:seed
pnpm test           # unit + integration
pnpm e2e            # playwright (needs pnpm dev)
pnpm lint && pnpm typecheck
pnpm build
```
(Keep this list true — update when scripts change.)

## 6. Architecture decisions (rationale in `docs/03-architecture.md`)
Monorepo · separate admin app/domain · NestJS modules per domain · Postgres-first analytics (partitioned events) + rrweb replays in object storage · adapter pattern + fake providers for every integration · integration credentials encrypted in DB, edited by Owner in admin · zod contracts shared · UZ hosting for PII.
**Log new decisions here** (date — decision — why):
- 2026-10-26 — initial architecture from handoff — see docs/03.

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
- Payme expects exact JSON-RPC error shapes and state codes; run their sandbox test suite.
- MoySklad requires gzip and has strict rate limits — queue + backoff.
- Eskiz SMS texts must be pre-approved templates; dynamic content only in allowed slots.
- Uzbek apostrophes (o', g') break naive slugify/search — use the shared `slugify` and search normalization (Latin↔Cyrillic, ʻ’' variants).
- Montserrat must include **cyrillic** subset for RU.
- Never render `[placeholder]` text or fake ratings; hide blocks without real data.
- Webhook handlers must be idempotent; return 200 quickly and process async.
- Time zone: Asia/Tashkent for cut-offs and SLA; tests with fixed clock.
- Don't cache personalized HTML/API at Cloudflare.

## 18. TODO / status
Track phases in `docs/progress.md` (create it). Current phase: **Phase 0**.

## 19. Known limitations
BTS API docs unknown (manual mode fallback); COD fiscal provider TBD; real content/prices pending (see `docs/13-open-questions.md`).

## 20. Future improvements
Marketplace (v2), installments (Uzum Nasiya, Alif), Uzum Market feed, ClickHouse for events at scale, native app / Telegram Mini App, B2B pricing for craftsmen.
