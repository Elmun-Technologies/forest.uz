# Forest

Premium European furniture & fabric paints e-commerce for Uzbekistan (UZ/RU): storefront, admin panel
(first-party analytics, heatmaps, CRM, SEO, integrations hub) and a Telegram service bot.

- Project knowledge base & conventions: [`CLAUDE.md`](CLAUDE.md)
- Specs: [`docs/`](docs) · Design: [`design/README.md`](design/README.md) · Status: [`docs/progress.md`](docs/progress.md)

## Quick start

Requirements: Node 22, pnpm 10, Docker.

```bash
pnpm i
pnpm dev     # infra + migrations + seed + api :4000, web :3000, admin :3001
```

`pnpm dev` creates `.env` from `.env.example` on first run and generates local secrets. All integrations
run on fake providers locally (`PROVIDERS_MODE=fake`); real credentials are entered by the owner in
Admin → Integrations and stored encrypted.

## Layout

```
apps/web      Next.js storefront (uz/ru)
apps/admin    Next.js admin panel
apps/api      NestJS API, webhooks, jobs, bot
packages/     contracts (domain + zod), db (Prisma), ui (tokens + components), config
infra/        docker compose, Dockerfiles, Caddy
e2e/          Playwright
```

See `CLAUDE.md → Commands` for tests, builds and the production-like compose stack.
