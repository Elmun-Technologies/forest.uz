# Progress

Current phase: **Phase 0 — done** (pending first green CI run on GitHub) → next: Phase 1 Storefront.

| Phase | Status | Notes |
|---|---|---|
| 0 Foundation | done | see report below |
| 1 Storefront | pending | |
| 2 Payments/delivery/SMS/auth | pending | |
| 3 Admin core | pending | |
| 4 Analytics/heatmaps/audiences/SEO | pending | |
| 5 Bot/automations/content | pending | |
| 6 Hardening & launch | pending | |

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
- `pnpm --filter @forest/api test:integration` — 14 tests green (Testcontainers Postgres + Redis, migrations + seed applied).
- `pnpm build` — green; prod-mode stack + `pnpm e2e` — 10/10 smoke tests green; dev outbox returns 404 in production.
- `pnpm dev` from scratch — infra up, migrations, seed, three apps serving.

### Mocked / not yet real
- Every integration runs on its fake adapter (no external calls). Real adapters arrive in Phase 2 (Payme, Click, Yandex, BTS, Eskiz, fiscal) and Phase 3+ (MoySklad, Telegram, ads, SEO tools).
- IKPU codes are a flagged all-zero placeholder; prices/stock are design samples; photos are stock placeholders.
- Docker images could not be built inside this sandbox (no network in containers) — validated by the CI `docker` job; the api runtime bundle (`pnpm deploy` + bundled Prisma engines) was validated on the host.

### Owner action needed
See `docs/13-open-questions.md` (new items 21–27 added in Phase 0).
