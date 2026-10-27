# Runbook · production deploy & rollback (UZ VPS)

Production = one VPS in Uzbekistan running Docker Compose (CLAUDE.md §15, §6 "Production deploy").
Everything goes through `infra/deploy/deploy.sh`; `infra/deploy/compose.sh` is `docker compose` with
the production project (`forest`), env files and override — use it for every manual command.

```
Internet ─► (Cloudflare, optional) ─► Caddy :80/:443 ─┬─► web ×WEB_REPLICAS :3000 (storefront)
                                                      ├─► admin :3001
                                                      ├─► api :4000 (REST, webhooks, BullMQ jobs, bot)
                                                      └─► storage :8333 (public bucket, GET only — CDN_DOMAIN)
networks: egress (caddy, api, web, admin, postgres→backup bucket, storage)  internal (+ redis only)
postgres :5432 · redis :6379 · storage :8333 — never published; only Caddy has ports.
```

## 1. First install (once)

1. VPS: Ubuntu LTS / Debian, 4 vCPU / 8 GB / 100 GB SSD minimum (see load-test sizing in
   `loadtest/README.md`), Docker Engine + compose plugin, `git`, `curl`, `flock`. Time zone UTC is
   fine (timers use `Asia/Tashkent` explicitly). Firewall: allow 22 (your IPs only), 80, 443 —
   with Cloudflare, 80/443 only from Cloudflare ranges (`infra/deploy/cloudflare-ips.sh` prints them).
2. `git clone <repo> /opt/forest/app && cd /opt/forest/app`
3. `cp .env.example .env` and fill the production values (`chmod 600 .env`). Generate every secret
   **on the server**: `openssl rand -base64 32` (APP_ENCRYPTION_KEY), `openssl rand -hex 32`
   (SESSION_SECRET, WEB_REVALIDATE_SECRET, TELEGRAM_WEBHOOK_SECRET, POSTGRES_PASSWORD,
   FOREST_APP_DB_PASSWORD, S3 keys). Required production values (deploy.sh `preflight` enforces):
   `APP_URL/ADMIN_URL/API_URL` https, `SITE_DOMAIN/ADMIN_DOMAIN/API_DOMAIN`, `S3_PUBLIC_URL`,
   `PROVIDERS_MODE=sandbox|live`, `DEV_ENDPOINTS=false`, `ALLOW_FAKE_PROVIDERS=false`,
   `TRUST_PROXY_HOPS` matching the proxy chain (1 = Caddy only; 2 = Cloudflare + `TRUSTED_PROXIES`
   = Cloudflare ranges), no `NODE_ENV` line. Keep a copy of `APP_ENCRYPTION_KEY` in the owner's
   password manager: without it the integration credentials and staff TOTP secrets are lost.
4. `cp infra/deploy/env.ops.example .env.ops && chmod 600 .env.ops` — backup bucket, passphrases,
   alert bot, heartbeat URLs (docs/runbooks/restore-db.md, monitoring.md).
5. `infra/deploy/deploy.sh preflight` → fix everything it lists.
6. `infra/deploy/deploy.sh` (builds the images from the checked-out commit, ~10 min the first time).
7. Seed once (owner account, settings, message templates, presets; it also inserts the **sample
   catalog** — replace it with the real one before launch, docs/launch-checklist.md):
   ```bash
   infra/deploy/compose.sh run --rm --no-deps -e S3_ENDPOINT=http://storage:8333 \
     -w /repo/packages/db migrate sh -c 'node_modules/.bin/tsx src/seed/index.ts --allow-production'
   ```
   (`S3_ENDPOINT` = your UZ S3 provider instead when not using the compose SeaweedFS.)
8. Backups: `infra/backup/pgbackrest.sh init`, then install the timers
   (`sudo cp infra/backup/systemd/* /etc/systemd/system/ && sudo systemctl daemon-reload &&
   sudo systemctl enable --now forest-backup-db.timer forest-pgbackrest.timer
   forest-backup-objects.timer forest-restore-drill.timer`) and the journald limits
   (`sudo cp infra/deploy/journald-forest.conf /etc/systemd/journald.conf.d/forest.conf`).
9. Log in to the admin as `OWNER_EMAIL` → forced TOTP enrolment → change the password.

## 2. Regular deploy

```bash
cd /opt/forest/app
git fetch && git checkout <release tag or commit>   # a clean tree: deploy.sh refuses local edits
infra/deploy/deploy.sh                              # or --pull with FOREST_REGISTRY set
```
What it does (and in this order): preflight → build `postgres migrate api web admin` (tag = git sha)
→ start postgres/redis/storage and wait for health → **pre-migration `pg_dump`** (local only,
`/var/backups/forest/pg`) → `prisma migrate deploy` (owner role) → `infra/deploy/db-roles.sql`
(API role grants, AuditLog append-only) → `up -d api web admin caddy` → health wait: every app
container healthy **and** `https://<site>/uz`, `https://<api>/ready`, `https://<admin>/login`
answer through Caddy (`HEALTH_TIMEOUT`, default 240 s) → records `.deploy/current`,
`.deploy/previous`, `.deploy/history`, keeps the images of the last 3 releases, posts "deployed
<tag>" to the alerts group.

If the health wait fails and a previous release exists, deploy.sh **rolls back automatically** to
it (images only) and exits non-zero with an alert. Measured on the local prod-like stack: a
release whose API cannot boot was detected after the 90 s health window and the previous release
was healthy again 21 s later; a normal deploy without image builds took 28 s.

Watch: `infra/deploy/compose.sh ps`, `infra/deploy/compose.sh logs -f --tail 100 api`,
GlitchTip, Uptime Kuma.

## 3. Rollback

```bash
infra/deploy/deploy.sh rollback      # previous ↔ current, ~20 s, health-checked
infra/deploy/deploy.sh status
```
- Rollback swaps **images only**; the schema stays migrated. Every migration must therefore be
  expand/contract: add columns/tables in release N, start using them in N, drop old ones only in
  N+1 or later. A migration that the previous release can't run on is a release blocker.
- If a migration itself broke data: stop writes (`infra/deploy/compose.sh stop api`), then restore
  (docs/runbooks/restore-db.md §PITR to just before the deploy; the deploy log has the time) or use
  the pre-migration dump in `/var/backups/forest/pg/` (newest file before the deploy).
- Older releases: `infra/deploy/deploy.sh --tag <sha>` (image must still exist, else check out the
  commit and run a normal deploy).

## 4. Scaling and sizing

- One Node process uses one core. `WEB_REPLICAS` (default 2) storefront containers run behind
  Caddy (`dynamic a` upstream, least connections). The k6 smoke (loadtest/README.md) measured
  ~15–20 dynamic storefront pages/s per replica; 200 rps needs product/category pages to become
  cacheable or ~10–12 replicas (cores).
- On-demand revalidation (`POST /api/revalidate`) reaches **one** replica (Docker DNS picks one);
  the others serve the old page until their ISR window (≤ 30–60 s). Acceptable today; a shared
  Next cache handler is the fix if instant freshness matters (docs/security/asvs-l2.md findings).
- The API is a single container (REST + BullMQ workers + bot). Checkout measured ~15 orders/s at
  ~1 core before latency climbed (p95 6 s); see loadtest/README.md before scaling it.

## 5. Caddy, TLS, Cloudflare

- Certificates: Caddy obtains Let's Encrypt certificates for SITE/ADMIN/API/CDN domains once DNS
  points at the VPS (ports 80/443 reachable). With Cloudflare proxied records use SSL mode
  **Full (strict)**; Caddy still gets its own certificate (HTTP-01 through Cloudflare works).
- Cloudflare: cache rules must **bypass** HTML and `/api/*` (personalised; CLAUDE.md §17); cache
  only `/_next/static/*`, `/_next/image*` and the CDN domain. Pages also set cookies (`fr_aid`,
  `fr_locale`) — Cloudflare never caches responses with `Set-Cookie` by default; keep it so.
- Real client IP: `TRUSTED_PROXIES` = Cloudflare ranges + `TRUST_PROXY_HOPS=2`
  (docs/runbooks/deploy-network.md). `deploy.sh preflight` rejects mismatched pairs.
- Security headers / CSP live in `infra/Caddyfile` (storefront, API, CDN) and
  `apps/admin/next.config.ts` (admin CSP — authoritative, Caddy sets none there). After changing
  either, run the CSP check against staging:
  ```bash
  cd e2e && SITE=https://<site> ADMIN=https://<admin> OWNER_EMAIL=… OWNER_PASSWORD=… \
    OWNER_TOTP_SECRET=… node csp-check.mjs
  ```
  It crawls the storefront (+ cart/checkout), logs into the admin, fails on any CSP violation or
  missing header, and proves enforcement (foreign script/image blocked, Telegram origins blocked
  outside `/kirish` and allowed on it). Result on the local prod-like stack (2026-10-27): 27
  storefront pages and 21 admin pages, **0 violations**; probes behaved as expected.
- `ADMIN_ALLOWLIST` (space-separated CIDRs) restricts the admin domain at the edge.

## 6. Local rehearsal (what was run for Phase 6)

The production compose was exercised as project `forest-prodtest` next to the dev stack with a
scratch override (images built from the repo Dockerfiles with the sandbox's proxy CA injected and
`apk add` removed — the sandbox blocks the Alpine mirror; `postgres:16-alpine` instead of the
pgBackRest image; Caddy on 127.0.0.1:8443/8080 with `*.localhost` names and Caddy's internal CA):
`deploy.sh --tag local --allow-fake` (fresh DB) → seed → `deploy.sh --tag local2` → a deliberately
broken API release (auto-rollback) → `deploy.sh rollback` → redeploy. Found and fixed on the way:
the API role needed SELECT on `event_parts` (boot watchdog), SeaweedFS on two networks needed
`-ip=storage -ip.bind=0.0.0.0`, Caddy has to be started once the apps are healthy, and the admin
image needs the `S3_PUBLIC_URL` build arg (its CSP is baked) — all fixed in the repo files.
