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
4. prints the names of all secrets it set, plus — **once** — the two secrets shared with Vercel
   (`DEMO_WEB_REVALIDATE_SECRET`, `DEMO_EDGE_PROXY_SECRET`) and the admin owner's initial
   password. With `GH_REPO` set and `gh` logged in it creates the GitHub environment `demo` and
   stores the two shared secrets there itself.

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
| `APP_ENCRYPTION_KEY` | 32 random bytes, base64 — Fly only (integration credentials, TOTP secrets); never given to Vercel |
| `WEB_REVALIDATE_SECRET` | 32 random bytes, hex — **same value on the storefront** (signs API → web calls: revalidation, 404 reports; missing = fail closed) |
| `EDGE_PROXY_SECRET` | 32 random bytes, hex — **same value on web and admin** (their middleware marks proxied `/api/*` calls; see Client IP) |
| `SESSION_SECRET`, `TELEGRAM_WEBHOOK_SECRET` | random hex |
| `OWNER_EMAIL`, `OWNER_INITIAL_PASSWORD` | your input / generated (seed creates the owner) |
| `APP_URL`, `WEB_INTERNAL_URL` | storefront Vercel URL (`WEB_INTERNAL_URL` = where the API posts `/api/revalidate`) |
| `ADMIN_URL` | admin Vercel URL (admin CSRF `Origin` check) |
| `API_URL` | `https://<api app>.fly.dev` |

Other secret apps: `<db app>` `POSTGRES_PASSWORD`, `<redis app>` `REDIS_PASSWORD` (Redis reads it
from a 0600 config file written at start, never from its command line). `DEV_ENDPOINTS_TOKEN` is
deliberately **not** set (see 4. "Dev endpoints"). Non-secret API
settings (`PROVIDERS_MODE=fake`, `ALLOW_FAKE_PROVIDERS=true`, `DEV_ENDPOINTS=true`,
`TRUST_PROXY_HOPS=2`, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=false`, `NODE_ENV=production`) are
in `infra/fly/api.fly.toml` `[env]`.

### 2.3 GitHub environment `demo`, secrets and variables

Settings → Environments → **New environment `demo`** (`provision.sh` creates it when `GH_REPO` is
set) → **Required reviewers**: add yourself (and *Prevent self-review* off if you deploy alone);
optionally *Deployment branches* = `main` + `demo`. Every workflow job that touches a credential
(`api`, `seed`, `web`/`admin`) runs in this environment, so it waits for an approval and only then
can read the environment's secrets. Put the **secrets in the environment** (not at repository
level) and the **variables at repository level** (the smoke job has no environment).

| Secrets | How to get it |
|---|---|
| `FLY_API_TOKEN` | `fly tokens create deploy --app <api app> --expiry 8760h` (if the seed job's `fly ssh console` is refused, use an org token: `fly tokens create org --org <org> --expiry 8760h`) |
| `VERCEL_TOKEN` | vercel.com → Account Settings → Tokens (scope: the team that owns both projects) |
| `VERCEL_ORG_ID` | team ID (`team_…`) or personal Vercel ID (2.1) |
| `VERCEL_PROJECT_ID_WEB` | storefront project ID |
| `VERCEL_PROJECT_ID_ADMIN` | admin project ID |
| `DEMO_WEB_REVALIDATE_SECRET` | printed (or stored) by `provision.sh` |
| `DEMO_EDGE_PROXY_SECRET` | printed (or stored) by `provision.sh` |

| Variables | Example |
|---|---|
| `FLY_API_APP` | `forest-demo-api` |
| `DEMO_WEB_URL` | `https://forest-demo-web.vercel.app` |
| `DEMO_ADMIN_URL` | `https://forest-demo-admin.vercel.app` |
| `DEMO_S3_PUBLIC_URL` | `https://forest-demo-public.t3.tigrisfiles.io` |

The workflow writes the Vercel environment (Production) itself on every run: both projects get
`API_INTERNAL_URL` and `API_URL` (= `https://<api app>.fly.dev`), `APP_URL` and
`EDGE_PROXY_SECRET` (sensitive); web also `S3_PUBLIC_URL` and `WEB_REVALIDATE_SECRET`
(sensitive, set in a web-only step); admin also `WEB_INTERNAL_URL` (heatmap backdrop). Vercel
never gets `APP_ENCRYPTION_KEY` (a run removes it if an older run stored it; the web reads it only
as a dev fallback outside production). Build-time values are stored as non-sensitive so `vercel
pull` can hand them to the build — Next bakes rewrites, the middleware's API origin and image
hosts at build time (CLAUDE.md §17); `EDGE_PROXY_SECRET` is read by the middleware at run time
(checked in a production build: it is not inlined).

**Workflow hardening.** Secrets are set as `env` of the single steps that use them — never of a
job, so third-party actions (checkout, pnpm/node/flyctl setup), `pnpm install` lifecycle scripts
and the Next build never see them; `vercel build` runs without the token. Actions are pinned by
commit SHA (resolved 2026-10-27 with `git ls-remote`): `actions/checkout` v4 =
`11d5960a326750d5838078e36cf38b85af677262`, `actions/setup-node` v4 =
`49933ea5288caeca8642d1e84afbd3f7d6820020`, `pnpm/action-setup` v4 =
`b906affcce14559ad1aafd4ab0e942779e9f58b1` (peeled annotated tag),
`superfly/flyctl-actions/setup-flyctl` 1.5 = `fc53c09e1bc3be6f54706524e3b82c4f462f77be`. The
Vercel CLI is pinned to 63.1.2; flyctl itself is installed in its latest release by the action.

## 3. Deploy

Actions → **Deploy demo** → *Run workflow* (first time: **seed = true**). Pushing to a `demo`
branch also deploys (no seed). Jobs:

1. **api** — first lists any missing secret/variable, then `flyctl deploy --remote-only --ha=false` (Fly's builder, target `demo`); the
   `release_command` runs `prisma migrate deploy` before the new machine takes traffic (event
   partitions are ensured by the API on boot); waits for `/ready` (DB + Redis).
2. **seed** (optional) — `fly ssh console` → `tsx src/seed/index.ts --allow-production`
   (idempotent; `seed_force` adds `--force`, overwriting catalog/content). Uploads the seed photos
   to the public bucket and creates the owner account.
3. **web / admin** — per project: `pnpm install` (no secrets yet) → settings → env → `vercel
   pull` → `vercel build --prod` (no token) → `vercel deploy --prebuilt --prod`.
4. **smoke** — `/ready`, storefront `/uz`, `/api/settings/public` (through the rewrite),
   `/robots.txt`, admin `/login`, an unsigned `POST /api/revalidate` must be **401**, the dev
   outbox listing and `POST /v1/dev/admin-totp` must be **404**, and a seed photo from the public
   bucket (warning only).

Each of `api`, `seed` and `web`/`admin` waits for an approval of the `demo` environment (the
two Vercel jobs wait at the same time and can be approved together).

First admin login: `OWNER_EMAIL` + the printed password → forced TOTP enrolment (any
authenticator app; the demo has no TOTP helper). Storefront OTP codes are not sent anywhere: a
tester reads the code for the phone they typed at
`<web>/api/dev/outbox?to=998901234567` (that phone's OTP SMS of the last 5 minutes only).

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
  a key derived from `WEB_REVALIDATE_SECRET` (HMAC-SHA256, ±300 s timestamp) and answers 401
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
`trust proxy = TRUST_PROXY_HOPS` (docs/runbooks/deploy-network.md). The demo sets `2` plus an
edge marker: the web and admin middleware (`apps/*/src/lib/edge-proxy.ts`) put
`X-Forest-Edge: <EDGE_PROXY_SECRET>` on every proxied `/api/*` request (a value sent by the browser
is dropped), and the API (`apps/api/src/common/edge-proxy.ts`) trusts the forwarded chain only when
that header matches (constant-time); any other request keeps just the last X-Forwarded-For entry.

| Path | `X-Forwarded-For` at the API | client IP the API uses |
|---|---|---|
| Browser → Vercel rewrite (+ edge header) → Fly proxy → API | `client, vercel-egress` (Vercel overwrites XFF with the client IP; Fly appends its peer) | client ✔ |
| Webhook / anyone → `*.fly.dev` directly | `<whatever the caller sent>, caller` → reduced to `caller` | the caller's real address ✔ |
| Vercel server code (RSC, route handlers) → API | `vercel-egress` | the Vercel egress IP (as in compose, where it is the web container) |

With `1` every visitor would share Vercel's few egress IPs (5 OTP sends/hour for the whole
demo). Without `EDGE_PROXY_SECRET` (compose, dev) nothing changes: Caddy is the trusted hop.
Checked locally on production builds (`next start` and the standalone server): the middleware's
request header reaches the rewrite destination, a browser-sent `X-Forest-Edge` is replaced or
removed, `Set-Cookie` and query strings pass, and `/api/revalidate` stays the filesystem route.
Not checkable here: Vercel's edge itself — **verify after the first deploy**: two networks must hit
separate OTP limits, one network gets 429 after 5 sends/hour, and a direct `*.fly.dev` call with a
forged `X-Forwarded-For` is limited by its real address.

### Dev endpoints in the demo

`DEV_ENDPOINTS=true` stays the master switch, but the demo provisions **no**
`DEV_ENDPOINTS_TOKEN`, so with `NODE_ENV=production`:

- `GET /v1/dev/outbox?to=<phone>` (no token) answers only that phone's `otp` messages of the
  last 5 minutes — enough for testers to log in; without `to` it is a 404, there is no listing.
- everything else under `/v1/dev/*` (full outbox and DELETE, fake shipment, Telegram login, bot
  updates/cart links, stored events) needs `X-Dev-Token` = `DEV_ENDPOINTS_TOKEN` → 404 on the demo.
- `POST /v1/dev/admin-totp` is additionally a 404 in production unless `ALLOW_DEV_ADMIN_TOTP=true`
  (only the CI e2e stack sets it), so admin 2FA stays real.
- `POST /v1/dev/fake-pay` is not a dev endpoint but the fake payment provider's callback (the
  storefront's `/fake-pay` page); it stays open in fake mode, addressed by the order's random
  public id.

To drive the demo with fake shipments etc. temporarily: `fly secrets set DEV_ENDPOINTS_TOKEN=$(openssl
rand -hex 32) -a <api app>` and send it as `X-Dev-Token`; unset it afterwards.

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
| Client IP | `TRUST_PROXY_HOPS=2` + `EDGE_PROXY_SECRET` marker from the web/admin middleware | Caddy (+ Cloudflare ranges) |
| `/api/revalidate` | public, HMAC (`WEB_REVALIDATE_SECRET`) only | blocked by Caddy + HMAC |
| Dev endpoints | OTP lookup only (no token, no admin TOTP) | off |
| Storage | Tigris (virtual-hosted, `S3_FORCE_PATH_STYLE=false`) | UZ S3-compatible provider |
| DB | single Postgres 16 container + volume snapshots | managed backups daily + PITR |
| Admin | `*.vercel.app` | own admin domain, X-Frame-Options/HSTS from Caddy as well |

Why production can't use this stack: Uzbek law requires personal data of citizens to be collected,
stored and processed on technical means located in Uzbekistan (registered in the State personal
data register); customer phones, addresses, orders and analytics identifiers are personal data.
Fly.io and Vercel have no Uzbek regions, so they are acceptable only while no real person's data is
involved.
