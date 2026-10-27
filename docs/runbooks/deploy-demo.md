# Runbook · demo deployment (Vercel + Fly.io)

A shareable **demo** of Forest: storefront and admin on **Vercel**, the API (NestJS with its BullMQ
workers/jobs, webhooks and bot), PostgreSQL 16, Redis 7 and S3 storage (Tigris) on **Fly.io**.
Everything is deployed by GitHub Actions (`.github/workflows/deploy-demo.yml`) with repository
secrets; nothing is deployed from a laptop except the one-time `infra/fly/provision.sh`.

> **Demo ≠ production.** The demo runs fake providers (`PROVIDERS_MODE=fake`,
> `ALLOW_FAKE_PROVIDERS=true`) and must only ever hold seed/synthetic data — **no real customer
> names, phones or addresses**; testers use made-up numbers (`+998 90 000 00 01`…). Production
> stays on a UZ-hosted VPS with Docker Compose (`infra/compose.yml`, CLAUDE.md §15): Uzbekistan's
> personal-data law (Law "On personal data" ЗРУ-547, localisation rule art. 27¹ in force since
> 2021-04-16; docs/14-security-and-compliance.md, lawyer confirmation pending) requires personal
> data of Uzbek citizens to be stored and processed on servers physically in Uzbekistan, which
> neither Fly.io (EU regions) nor Vercel can offer.

```
Browser ──► Vercel fra1: web (Next)  ──/api/* rewrite──┐
        └─► Vercel fra1: admin (Next) ─/api/* rewrite──┤
                                                       ▼
                         Fly fra: <api app> (NestJS + BullMQ) ── 6PN ──► <db app>  postgres:16
                                       │   ▲                      └────► <redis app> redis:7
                                       │   └ signed POST /api/revalidate (→ web)
                                       └──► Tigris: <public bucket> (images, public URL)
                                                    <private bucket> (replays, bot photos)
```

## 1. What gets created

| Piece | Where | Config |
|---|---|---|
| API (+ jobs, bot, webhooks) | Fly app `<prefix>-api`, 1 × shared-cpu-1x 1 GB, `fra` | `infra/fly/api.fly.toml`, image `infra/docker/api.Dockerfile` target `demo` |
| PostgreSQL 16 | Fly app `<prefix>-db`, `postgres:16-alpine` + 1 GB volume, private | `infra/fly/postgres.fly.toml` |
| Redis 7 | Fly app `<prefix>-redis`, `redis:7-alpine` + 1 GB volume, AOF, `noeviction`, private | `infra/fly/redis.fly.toml` |
| Object storage | Tigris buckets `<prefix>-public` (public read) and `<prefix>-private` | `fly storage create` in `provision.sh` |
| Storefront | Vercel project (Root Directory `apps/web`), functions in `fra1` | `apps/web/vercel.json` |
| Admin | Vercel project (Root Directory `apps/admin`), functions in `fra1` | `apps/admin/vercel.json` |

**Why these choices**

- **Region `fra` (Frankfurt)** — Fly has no region in Central Asia, and Warsaw/Bucharest were
  retired in its region consolidation; Frankfurt is the closest maintained region to Tashkent and
  the usual transit point for Uzbek traffic to Europe. Vercel functions run in `fra1`
  (`regions` in `vercel.json`; Vercel's default is Washington `iad1`), so the several server →
  API calls of every page render stay inside Frankfurt instead of crossing the Atlantic.
- **Postgres as a plain `postgres:16-alpine` Fly app** — the same image as `infra/compose.yml`,
  so partitioned tables, plpgsql functions and raw-SQL migrations behave exactly like dev/prod;
  ~$4/month. Fly Managed Postgres (from $38/month, Basic plan) would add HA and backups that a demo
  doesn't need; switch by replacing `DATABASE_URL` if the demo becomes long-lived.
- **Self-run Redis** — BullMQ needs `maxmemory-policy noeviction` and a long-lived connection
  with blocking commands; a small Redis with AOF on a volume costs ~$2/month. Upstash (Fly's
  managed Redis) bills per command, and BullMQ's polling/blocking traffic makes that both costly and
  a poor fit.
- **Tigris** — Fly's integrated S3-compatible storage, free tier (5 GB, free egress). Buckets
  created since 2025-02 accept only *virtual-hosted* addressing, so the demo sets
  `S3_FORCE_PATH_STYLE=false` (API and seed read it; default `true` keeps SeaweedFS/MinIO working).
  Public objects are served from `https://<public bucket>.t3.tigrisfiles.io/<key>` (new accounts;
  older Fly accounts can also use `<bucket>.fly.storage.tigris.dev`), which is `S3_PUBLIC_URL` and
  the storefront's `next/image` remote pattern. Private files (replays, bot photos) are only served
  through 10-minute signed URLs.

## 2. One-time setup (owner)

Accounts: a Fly.io account (credit card required) and a Vercel account. On Vercel the free
**Hobby plan is for non-commercial personal use only** — a business demo belongs on **Pro**.

### 2.1 Vercel projects (first, their URLs are needed by Fly)

```bash
npx vercel@63.1.2 login
npx vercel@63.1.2 project add forest-demo-web
npx vercel@63.1.2 project add forest-demo-admin
```

- Do **not** connect the Git repository to these projects (deploys come from the workflow; a Git
  connection would deploy twice and without the build-time env).
- Note each project's production URL (Project → Domains, normally `https://<name>.vercel.app`).
- The workflow sets Root Directory (`apps/web` / `apps/admin`), framework Next.js and Node.js
  `22.x` through the Vercel API on every run; if that call fails it prints a warning and you set
  them in Project → Settings → Build and Deployment.
- Project IDs: Project → Settings → General → *Project ID*. Team ID (`team_…`): Team → Settings →
  General; on a personal account use the *Vercel ID* from Account Settings.

### 2.2 Fly resources — `infra/fly/provision.sh`

Install flyctl (`curl -L https://fly.io/install.sh | sh`), `jq` and `openssl`, then from the repo
root:

```bash
fly auth login
DEMO_WEB_URL=https://forest-demo-web.vercel.app \
DEMO_ADMIN_URL=https://forest-demo-admin.vercel.app \
OWNER_EMAIL=owner@example.com \
FLY_ORG=personal DEMO_PREFIX=forest-demo GH_REPO=<owner>/<repo> \
infra/fly/provision.sh
```

It is idempotent: existing apps, volumes, buckets and secrets are kept, generated secrets are
never regenerated (re-running only refreshes the URL secrets). Fly app names and Tigris bucket
names are global — pick another `DEMO_PREFIX` if one is taken. It:

1. creates the three apps, the `pgdata` and `redisdata` volumes, deploys Postgres and Redis;
2. creates the Tigris buckets (public one with `--public`) and stores the printed access key as
   the API's `S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_ENDPOINT`;
3. stages (`fly secrets set --stage`, applied by the first API deploy) every API secret below;
4. prints the names of all secrets it set, plus — **once** — the generated `APP_ENCRYPTION_KEY`
   (unless `GH_REPO` is set and `gh` is logged in, then it is stored as the GitHub secret
   `DEMO_APP_ENCRYPTION_KEY` directly) and the admin owner's initial password.

**Tigris key scope (manual, once).** The API uses one key for both buckets. Keys made by
`fly storage create` may be scoped to their own bucket: open `fly storage dashboard
<prefix>-public` → *Access keys* → the key whose id the script printed → add **Editor** on
`<prefix>-private`. The seed job fails with "object storage unavailable" if this is missing.

Fly secrets of the API app (values generated or derived by the script; never committed):

| Secret | Value |
|---|---|
| `DATABASE_URL` | `postgresql://forest:<generated>@<db app>.internal:5432/forest?connection_limit=10` |
| `REDIS_URL` | `redis://:<generated>@<redis app>.internal:6379?family=6` (`.internal` is IPv6-only; ioredis defaults to IPv4) |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | from `fly storage create` |
| `S3_BUCKET_PUBLIC`, `S3_BUCKET_PRIVATE`, `S3_PUBLIC_URL` | bucket names, `https://<public bucket>.t3.tigrisfiles.io` |
| `APP_ENCRYPTION_KEY` | 32 random bytes, base64 — **must equal** the storefront's (revalidation HMAC key is derived from it) |
| `SESSION_SECRET`, `TELEGRAM_WEBHOOK_SECRET` | random hex |
| `OWNER_EMAIL`, `OWNER_INITIAL_PASSWORD` | your input / generated (seed creates the owner) |
| `APP_URL`, `WEB_INTERNAL_URL` | storefront Vercel URL (`WEB_INTERNAL_URL` = where the API posts `/api/revalidate`) |
| `ADMIN_URL` | admin Vercel URL (admin CSRF `Origin` check) |
| `API_URL` | `https://<api app>.fly.dev` |

Other secret apps: `<db app>` `POSTGRES_PASSWORD`, `<redis app>` `REDIS_PASSWORD`. Non-secret API
settings (`PROVIDERS_MODE=fake`, `ALLOW_FAKE_PROVIDERS=true`, `DEV_ENDPOINTS=true`,
`TRUST_PROXY_HOPS=2`, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=false`, `NODE_ENV=production`) are
in `infra/fly/api.fly.toml` `[env]`.

### 2.3 GitHub repository secrets and variables

Settings → Secrets and variables → Actions.

| Secrets | How to get it |
|---|---|
| `FLY_API_TOKEN` | `fly tokens create deploy --app <api app> --expiry 8760h` (if the seed job's `fly ssh console` is refused, use an org token: `fly tokens create org --org <org> --expiry 8760h`) |
| `VERCEL_TOKEN` | vercel.com → Account Settings → Tokens (scope: the team that owns both projects) |
| `VERCEL_ORG_ID` | team ID (`team_…`) or personal Vercel ID (2.1) |
| `VERCEL_PROJECT_ID_WEB` | storefront project ID |
| `VERCEL_PROJECT_ID_ADMIN` | admin project ID |
| `DEMO_APP_ENCRYPTION_KEY` | printed (or stored) by `provision.sh` |

| Variables | Example |
|---|---|
| `FLY_API_APP` | `forest-demo-api` |
| `DEMO_WEB_URL` | `https://forest-demo-web.vercel.app` |
| `DEMO_ADMIN_URL` | `https://forest-demo-admin.vercel.app` |
| `DEMO_S3_PUBLIC_URL` | `https://forest-demo-public.t3.tigrisfiles.io` |

The workflow writes the Vercel environment (Production) itself on every run: both projects get
`API_INTERNAL_URL` and `API_URL` (= `https://<api app>.fly.dev`) and `APP_URL`; web also
`S3_PUBLIC_URL` and `APP_ENCRYPTION_KEY` (sensitive); admin also `WEB_INTERNAL_URL` (heatmap
backdrop). Build-time values are stored as non-sensitive so `vercel pull` can hand them to the
build — Next bakes rewrites, middleware env and image hosts at build time (CLAUDE.md §17).

## 3. Deploy

Actions → **Deploy demo** → *Run workflow* (first time: **seed = true**). Pushing to a `demo`
branch also deploys (no seed). Jobs:

1. **preflight** — fails fast listing any missing secret/variable.
2. **api** — `flyctl deploy --remote-only --ha=false` (Fly's builder, target `demo`); the
   `release_command` runs `prisma migrate deploy` before the new machine takes traffic (event
   partitions are ensured by the API on boot); waits for `/ready` (DB + Redis).
3. **seed** (optional) — `fly ssh console` → `tsx src/seed/index.ts --allow-production`
   (idempotent; `seed_force` adds `--force`, overwriting catalog/content). Uploads the seed photos
   to the public bucket and creates the owner account.
4. **web / admin** — per project: settings → env → `vercel pull` → `vercel build --prod` →
   `vercel deploy --prebuilt --prod`.
5. **smoke** — `/ready`, storefront `/uz`, `/api/settings/public` (through the rewrite),
   `/robots.txt`, admin `/login`, an unsigned `POST /api/revalidate` must be **401**, and a seed
   photo from the public bucket (warning only).

First admin login: `OWNER_EMAIL` + the printed password → forced TOTP enrolment (any
authenticator app). Storefront OTP codes are not sent anywhere: read them at
`<web>/api/dev/outbox` (dev endpoints are on in the demo).

## 4. How the pieces fit (checked against the code)

- **First-party cookies.** Browsers call `<web>/api/*` and `<admin>/api/*`; Vercel proxies those
  external rewrites to `https://<api app>.fly.dev/v1/*` and passes `Set-Cookie` back. The API never
  sets a `Domain` attribute (`common/session.ts`, `admin/auth/admin-session.service.ts`), so
  `fr_session`/`fr_cart`/`fr_aid` belong to the storefront host and `fr_admin`/`fr_admin_csrf` to
  the admin host; `Secure` because `NODE_ENV=production`; SameSite Lax (shop) / Strict (admin)
  work because every call is same-origin. CORS is not involved.
- **Rewrite caching.** Vercel caches external-rewrite responses by their `Cache-Control` for
  projects created since 2026-04-06; `vercel.json` sends `x-vercel-enable-rewrite-caching: 0` for
  `/api/*` so personalised or `Vary: Accept-Language` API answers are never cached at Vercel's
  edge. `robots.txt` and sitemaps may still be cached by their own headers (language-neutral).
- **Admin CSRF.** Vercel forwards the browser's `Origin`; the API requires it to equal
  `ADMIN_URL`. Use the admin's production URL only — Vercel's per-deployment URLs
  (`…-<hash>.vercel.app`) have another origin, fail CSRF and are behind Vercel Authentication
  anyway. After adding a custom domain, update `ADMIN_URL`/`APP_URL` (2.2 re-run or
  `fly secrets set`) and the GitHub variables, then redeploy.
- **`/api/revalidate`** is a filesystem route, so it wins over the `/api/*` rewrite on Vercel as
  in compose. Without Caddy it is reachable from the internet; it accepts only bodies signed with
  the key derived from `APP_ENCRYPTION_KEY` (HMAC-SHA256, ±300 s timestamp) and answers 401
  otherwise (smoke-tested). The API posts to `WEB_INTERNAL_URL` after commits; failures only delay
  freshness to the ISR window.
- **SEO files.** `/robots.txt`, `/sitemap.xml`, `/sitemaps/:file` and `/<key>.txt` (IndexNow) are
  rewrites to the API. IndexNow pings are skipped in fake mode and unless `APP_URL` is a public
  https host — so never from the demo. Search engines should not index the demo: keep it on
  `*.vercel.app` or set a `noindex` robots override in A9.
- **Static routes** `/t.js` (tracker) and `/r.js` (replay recorder) are force-static route
  handlers and run unchanged on Vercel. Middleware (locale, `/t/<token>`, `fr_ident`) runs at the
  edge with the build-time `API_INTERNAL_URL`.
- **Images.** `next/image` uses Vercel's optimizer with the remote pattern built from
  `S3_PUBLIC_URL` at build time (Hobby/Pro quotas apply).
- **Admin heatmap backdrop** (`/heatmap-snapshot`, `/sf/*`) fetches the storefront over the
  internet at `WEB_INTERNAL_URL` — the anonymous production URL, which is public.
- **BullMQ / bot** live in the single API machine (`auto_stop_machines = "off"`,
  `min_machines_running = 1`); a second machine is harmless for BullMQ but doubles cost.

### Client IP (rate limits)

The API keys OTP/checkout/lead/admin-login limits on Express `req.ip` with
`trust proxy = TRUST_PROXY_HOPS` (docs/runbooks/deploy-network.md). In the demo the chain is:

| Path | `X-Forwarded-For` at the API | `TRUST_PROXY_HOPS=2` gives |
|---|---|---|
| Browser → Vercel rewrite → Fly proxy → API | `client, vercel-egress` (Vercel overwrites XFF with the client IP; Fly appends its peer) | client ✔ |
| Webhook / anyone → `*.fly.dev` directly | `<whatever the caller sent>, caller` | the caller's own XFF entry — **spoofable** |
| Vercel server code (RSC, route handlers) → API | `vercel-egress` | the Vercel egress IP (as in compose, where it is the web container) |

With `1` every visitor would share Vercel's few egress IPs (5 OTP sends/hour for the whole
demo). `2` is correct for real browser traffic; the cost is that a client calling the Fly URL
directly can pick its IP and dodge per-IP limits. Per-phone OTP caps, per-account admin lockout and
the per-customer rules still hold, and fake providers send nothing that costs money — acceptable
for a demo. A production-grade fix (not implemented) would add a shared-secret request header on
Vercel's rewrite (project routing rule / request-header transform) and let the API trust the
forwarded client IP only when that header matches. **Verify after the first deploy:** two
networks must hit separate OTP limits; one network gets 429 after 5 sends/hour. If Fly's XFF
order differs from the table, adjust `TRUST_PROXY_HOPS` in `api.fly.toml`.

### `DEV_ENDPOINTS=true` in the demo

Needed so testers can read OTP codes (`/v1/dev/outbox`). It also exposes `POST /v1/dev/admin-totp`
(the next TOTP code for any staff email) and fake payment/shipment controls — admin login is then
effectively password-only. Fine for synthetic data; set `DEV_ENDPOINTS = "false"` in
`api.fly.toml` (and redeploy) before showing the demo to anyone untrusted for longer periods.

## 5. Operations

- **Logs:** `fly logs -a <api app>`; Vercel → Project → Logs (external rewrites appear there too).
- **Console:** `fly ssh console -a <api app>`; DB: `fly ssh console -a <db app> -C "psql -U forest forest"`.
- **Backups:** Fly snapshots volumes daily (kept 5 days by default): `fly volumes snapshots list <vol id>`.
  No PITR — it's a demo.
- **Reset demo data** (keeps apps, secrets and buckets):
  ```bash
  fly ssh console -a <db app> -C "psql -U forest -d postgres -c 'DROP DATABASE forest WITH (FORCE)' -c 'CREATE DATABASE forest OWNER forest'"
  fly ssh console -a <redis app> -C "sh -c 'redis-cli -a \"\$REDIS_PASSWORD\" --no-auth-warning FLUSHALL'"
  ```
  then run the workflow with **seed = true** (the deploy re-applies migrations and restarts the API,
  which recreates the event partitions). Uploaded files stay in the buckets; empty them in the
  Tigris console if needed (seed photos are re-used by key).
- **Custom domains later:** add them in Vercel (Project → Domains), then set `DEMO_WEB_URL` /
  `DEMO_ADMIN_URL`, re-run `provision.sh` with the new URLs (refreshes `APP_URL`, `ADMIN_URL`,
  `WEB_INTERNAL_URL`), and run the workflow. For the API, `fly certs add api.<domain> -a <api app>`
  and switch `API_INTERNAL_URL` by changing the workflow's `api=` line (it derives `*.fly.dev`).
- **Tear down:** `fly apps destroy <api app>`, `<db app>`, `<redis app>`; `fly storage destroy
  <bucket>` ×2; delete the Vercel projects.

## 6. Monthly cost estimate (checked 2026-10-27)

| Item | Estimate | Source |
|---|---|---|
| API machine shared-cpu-1x 1 GB (always on) | $5.70–6.70 | Fly pricing (fly.io/docs/about/pricing); RAM went $5 → $6/GB on 2026-10-01 per third-party reports |
| Postgres machine shared-cpu-1x 512 MB | $3.20–3.70 | same |
| Redis machine shared-cpu-1x 256 MB | $1.94–2.19 | same |
| 2 × 1 GB volumes + snapshots | ~$0.45 | $0.15/GB-month volumes, $0.08/GB-month snapshots (2026) |
| Fly egress, shared IPv4, builder | ~$0–1 | shared IPv4 free; EU egress ~$0.02/GB |
| Tigris (≤ 5 GB, free egress) | $0 | tigrisdata.com/pricing free tier |
| Vercel Hobby / **Pro** | $0 / **$20 per member** | vercel.com/pricing — Hobby is non-commercial only |
| **Total** | **≈ $12–15** (Hobby) · **≈ $32–35** (Vercel Pro, one member) | |

Fly Managed Postgres instead of the Postgres app: + ~$35 (Basic $38/month). Prices change — check
the provider pages before committing to a budget.

## 7. Demo vs production

| | Demo (this runbook) | Production (CLAUDE.md §15) |
|---|---|---|
| Hosting | Vercel (fra1) + Fly.io (fra), EU | UZ-hosted VPS, Docker Compose + Caddy, Cloudflare |
| Data | seed/synthetic only, no PII | real customers (PII must stay in Uzbekistan) |
| Providers | fake (`ALLOW_FAKE_PROVIDERS=true`), dev endpoints on | sandbox/live, dev endpoints off |
| Client IP | `TRUST_PROXY_HOPS=2`, spoofable via `*.fly.dev` | Caddy (+ Cloudflare ranges), not spoofable |
| `/api/revalidate` | public, HMAC only | blocked by Caddy + HMAC |
| Storage | Tigris (virtual-hosted, `S3_FORCE_PATH_STYLE=false`) | UZ S3-compatible provider |
| DB | single Postgres 16 container + volume snapshots | managed backups daily + PITR |
| Admin | `*.vercel.app` | own admin domain, X-Frame-Options/HSTS from Caddy as well |

Why production can't use this stack: Uzbek law requires personal data of citizens to be collected,
stored and processed on technical means located in Uzbekistan (registered in the State personal
data register); customer phones, addresses, orders and analytics identifiers are personal data.
Fly.io and Vercel have no Uzbek regions, so they are acceptable only while no real person's data is
involved.
