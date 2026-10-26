# 12 · Build roadmap & acceptance criteria

Work **phase by phase**. Finish a phase (all acceptance criteria green, tests pass, CLAUDE.md updated, commits made) before starting the next. At the end of each phase, write a short report in `docs/progress.md` (what was built, what's mocked, what needs owner action).

## Phase 0 — Foundation
- Monorepo (pnpm, Turborepo), TS strict everywhere, ESLint/Prettier, Husky + lint-staged, commitlint (conventional commits).
- `infra/compose.yml`: postgres 16, redis 7, minio, mailpit (optional), api, web, admin, caddy. `pnpm dev` starts everything; `pnpm db:migrate`, `pnpm db:seed`.
- `packages/db` with schema from `prisma/schema.prisma`, raw SQL migrations (partitions, extensions, sequences), seed.
- `packages/contracts`, `packages/ui` (tokens + base components), `packages/config`.
- Integration framework + encryption util + fake providers.
- CI (GitHub Actions): install, typecheck, lint, unit tests, build, Playwright smoke against compose.
**Done when:** fresh clone → `cp .env.example .env && pnpm i && pnpm dev` works; seed data visible via API; CI green.

## Phase 1 — Storefront MVP (UI fidelity + core commerce, COD + fake payments)
Home, Catalog (+ mobile sheet), Product (calculator, sticky bar, countdown, waitlist), Cart, Checkout (COD + fake Payme/Click), Order received, Tracking page, Legal pages, Edge states, Header/Footer, Popup, Login (OTP via fake SMS), Cabinet, i18n UZ/RU, search with synonyms, basic SEO (meta, hreflang, sitemap, schema).
**Done when:** Playwright e2e passes: browse → filter → product → calculator → add → promo `SALOM10` → checkout COD → order page → tracking link; same on 390 px viewport; RU locale works; Lighthouse mobile ≥ 90 on Home/Catalog/Product (seeded data); visual comparison with `design/screens` reviewed; no `[placeholder]` strings rendered.

## Phase 2 — Payments, fiscal, delivery, SMS, auth
Payme Merchant API (sandbox scenarios pass), Click SHOP API (test), fiscal receipt data (IKPU), COD flow + manual fiscal fallback, Yandex Delivery adapter (quote, claim, status), BTS adapter (API or manual mode), Eskiz SMS (OTP + status), Telegram login, reservations & expiry job, refunds.
**Done when:** contract tests for Payme/Click (all documented error codes) pass; idempotency proven (duplicate webhooks don't double-pay); reservation expiry releases stock; SLA timers computed correctly incl. 18:00 cut-off (unit tests with fixed clock).

## Phase 3 — Admin core
Admin auth (password + TOTP), RBAC, audit log, A6/A7 orders (state machine actions), A11 products, A4/A5 customers (basic 360 without analytics), A14 promo, A15 reviews, A16 settings (staff, delivery zones, store), A10 integrations hub + A13 MoySklad sync.
**Done when:** each role sees only permitted actions (tests); MoySklad sync against sandbox/fake: product/price/stock pull, order push, webhook handling, log; all admin lists filter/paginate server-side.

## Phase 4 — Analytics, heatmaps, audiences, ad signals, SEO center
Tracker package, ingest, sessions, channel rules, reports A1/A2, rrweb replay + heatmaps A3, journey & attribution (A5/A7), audiences A8 + destinations (fake + Meta/Google when keys), CAPI/Google/TikTok forwarding, ad spend import, SEO center A9 (meta CRUD, redirects, 404, sitemap, robots, verification codes, GSC/YWM API).
**Done when:** synthetic traffic script (Playwright) generates sessions → dashboard numbers match DB truth; replay plays with masked inputs; audience size preview equals SQL; tracker < 6 KB gz; no PII in events table (test).

## Phase 5 — Telegram bot & automations, content
Bot flows 1–5, operator inbox A12, templates, caps/quiet hours, abandoned-cart job, review request job, waitlist notifications, outbound webhooks + API keys, Ilhom & Brend pages (CMS), AI drafts (descriptions, SEO, operator replies).
**Done when:** each flow has an integration test with a fake Telegram transport; caps & opt-out enforced; bot deep links restore cart.

## Phase 6 — Hardening & launch
Security review (OWASP ASVS L2 checklist), rate limits, backups + restore drill, load test (k6: 200 rps catalog, 20 rps checkout), error monitoring, uptime alerts, runbooks (`docs/runbooks/*.md`: payment incident, sync failure, restore DB), production compose/deploy script, launch checklist (launch kit all green, legal reviewed, real photos/prices, IKPU complete, Payme/Click live keys, DNS/TLS, GSC/YWM verified, sitemap submitted).

## v2 — Marketplace (not now)
Seller onboarding & cabinet, per-seller shipments, commissions & payouts, seller ratings, Uzum Market feed, installments (Uzum Nasiya, Alif).

## Testing strategy
- Unit (Vitest): pricing engine, promo rules, SLA calculator, state machine, signature verification, channel classifier, attribution.
- Integration (Vitest + Testcontainers Postgres/Redis): API modules, webhooks, jobs.
- E2E (Playwright): storefront flows desktop + mobile, admin critical flows; visual snapshots for key screens.
- Contract: Payme/Click request/response fixtures from official docs.
- Coverage target: domain logic ≥ 90 %, overall ≥ 70 %.
