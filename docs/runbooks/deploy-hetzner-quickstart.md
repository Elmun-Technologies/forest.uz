# Runbook · Hetzner (backend) + Vercel (web/admin) — launch today, build the rest slowly

Owner decision (2026-11-07, CLAUDE.md §6): web + admin run on **Vercel** right away so the site is
reachable today; everything server-side (API, Postgres, Redis, object storage, and later the
backup/monitoring/bot pieces) is built up on the **Hetzner VPS**, one service at a time, instead of
bringing up the full `infra/compose.yml` stack at once. No real domain is needed yet either — the
API gets its HTTPS hostname from the server's own IP via **nip.io** (a free wildcard DNS service:
`api.<ip-with-dashes>.nip.io` resolves straight to `<ip>`, no registration, no DNS panel). Caddy
still gets a real Let's Encrypt certificate for it. Swapping in a real domain later is a 3-line env
change (§2/§6 below) plus one A record — nothing else changes.

Once web and admin also move onto the same server, switch to the plain, already-documented
full-stack flow in `docs/runbooks/deploy-and-rollback.md` — nothing here conflicts with it.

```
Browser ──► Vercel: web  (Root Directory apps/web)   ──/api/* rewrite──┐
        └─► Vercel: admin (Root Directory apps/admin) ─/api/* rewrite──┤
                                                                       ▼
          Hetzner VPS: Caddy :80/:443 (api.<ip>.nip.io, cdn.<ip>.nip.io)
                        └──► api (NestJS + BullMQ) ──► postgres, redis, storage (SeaweedFS)
```

> Same compliance note as before, still open: a VPS outside Uzbekistan doesn't satisfy the
> personal-data localisation rule (§15) once real customer PII is stored. Launch today with
> `PROVIDERS_MODE=fake` and no real customer data; resolve hosting location before real orders.

## 0. What I need from you

1. The Hetzner server's **IP address**.
2. Confirm root SSH already works (and how you log in — password or a key already added in the
   Hetzner console).

That's it — no domain, no DNS panel.

## 1. Server: lock it down, install Docker, clone the repo

```bash
ssh root@<server-ip>
apt-get update && apt-get -y upgrade
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
curl -fsSL https://get.docker.com | sh
mkdir -p /opt/forest && cd /opt/forest
git clone https://github.com/Elmun-Technologies/forest.uz app && cd app
git checkout main
```
(Skip anything already done if this server was set up before.)

## 2. `.env` on the server

Replace `<ip>` below with the server's real IP, dashes instead of dots (e.g. `5.6.7.8` →
`5-6-7-8`) — only in the `sed` block, nowhere else needs it.

```bash
cd /opt/forest/app
cp .env.example .env
chmod 600 .env
cp infra/deploy/env.ops.example .env.ops && chmod 600 .env.ops   # backups/alerts — fill in later

IP_DASHED=<ip-with-dashes>   # e.g. IP_DASHED=5-6-7-8 for server IP 5.6.7.8

# Generate every secret now, on the server.
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
SESSION_SECRET=$(openssl rand -hex 32)
WEB_REVALIDATE_SECRET=$(openssl rand -hex 32)
EDGE_PROXY_SECRET=$(openssl rand -hex 32)
TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
FOREST_APP_DB_PASSWORD=$(openssl rand -hex 24)
S3_ACCESS_KEY=$(openssl rand -hex 12)
S3_SECRET_KEY=$(openssl rand -hex 24)
OWNER_INITIAL_PASSWORD=$(openssl rand -base64 18)

sed -i \
  -e "s#^APP_ENCRYPTION_KEY=.*#APP_ENCRYPTION_KEY=$APP_ENCRYPTION_KEY#" \
  -e "s#^SESSION_SECRET=.*#SESSION_SECRET=$SESSION_SECRET#" \
  -e "s#^WEB_REVALIDATE_SECRET=.*#WEB_REVALIDATE_SECRET=$WEB_REVALIDATE_SECRET#" \
  -e "s#^EDGE_PROXY_SECRET=.*#EDGE_PROXY_SECRET=$EDGE_PROXY_SECRET#" \
  -e "s#^TELEGRAM_WEBHOOK_SECRET=.*#TELEGRAM_WEBHOOK_SECRET=$TELEGRAM_WEBHOOK_SECRET#" \
  -e "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$POSTGRES_PASSWORD#" \
  -e "s#^FOREST_APP_DB_PASSWORD=.*#FOREST_APP_DB_PASSWORD=$FOREST_APP_DB_PASSWORD#" \
  -e "s#^S3_ACCESS_KEY=.*#S3_ACCESS_KEY=$S3_ACCESS_KEY#" \
  -e "s#^S3_SECRET_KEY=.*#S3_SECRET_KEY=$S3_SECRET_KEY#" \
  -e "s#^OWNER_INITIAL_PASSWORD=.*#OWNER_INITIAL_PASSWORD=$OWNER_INITIAL_PASSWORD#" \
  -e 's#^OWNER_EMAIL=.*#OWNER_EMAIL=you@yourdomain.com#' \
  -e "s#^API_URL=.*#API_URL=https://api.$IP_DASHED.nip.io#" \
  -e "s#^SITE_DOMAIN=.*#SITE_DOMAIN=site.$IP_DASHED.nip.io#" \
  -e "s#^ADMIN_DOMAIN=.*#ADMIN_DOMAIN=admin.$IP_DASHED.nip.io#" \
  -e "s#^API_DOMAIN=.*#API_DOMAIN=api.$IP_DASHED.nip.io#" \
  -e "s#^CDN_DOMAIN=.*#CDN_DOMAIN=cdn.$IP_DASHED.nip.io#" \
  -e "s#^S3_PUBLIC_URL=.*#S3_PUBLIC_URL=https://cdn.$IP_DASHED.nip.io/forest-public#" \
  -e 's#^S3_FORCE_PATH_STYLE=.*#S3_FORCE_PATH_STYLE=true#' \
  -e 's#^S3_ENDPOINT=.*#S3_ENDPOINT=http://storage:8333#' \
  -e 's#^DATABASE_URL=.*#DATABASE_URL=postgresql://forest:'"$POSTGRES_PASSWORD"'@postgres:5432/forest#' \
  -e 's#^REDIS_URL=.*#REDIS_URL=redis://redis:6379#' \
  -e 's#^PROVIDERS_MODE=.*#PROVIDERS_MODE=fake#' \
  -e 's#^ALLOW_FAKE_PROVIDERS=.*#ALLOW_FAKE_PROVIDERS=true#' \
  -e 's#^DEV_ENDPOINTS=.*#DEV_ENDPOINTS=true#' \
  -e 's#^TRUST_PROXY_HOPS=.*#TRUST_PROXY_HOPS=2#' \
  -e 's#^TRUSTED_PROXIES=.*#TRUSTED_PROXIES=0.0.0.0/0 ::/0#' \
  .env

echo "owner password: $OWNER_INITIAL_PASSWORD"   # save it now, not shown again
```

`APP_URL` and `WEB_INTERNAL_URL` still need the Vercel storefront URL, but you won't know it until
after step 4 — edit `.env` then (one line each) and restart the API (step 6 shows how); nothing
else below depends on them.

**Why `TRUSTED_PROXIES=0.0.0.0/0 ::/0` here (not Cloudflare ranges, not the default):** Vercel's
outbound IPs aren't a fixed, published range the way Cloudflare's are, so Caddy can't selectively
trust "Vercel" by address. The real security boundary is `EDGE_PROXY_SECRET`: the API only trusts
the forwarded client IP on requests carrying the matching header (which only the web/admin
middleware can send); every other caller — including anyone hitting the API hostname directly —
gets reduced to Caddy's own honest view of who connected, never a header they supplied.
**Caveat:** this Caddy instance isn't serving the admin domain yet (Vercel is), so this permissive
setting costs nothing today. The moment admin also moves onto this server's Caddy, tighten
`TRUSTED_PROXIES` back down (Cloudflare ranges, or drop it to `private_ranges` and accept
shared-IP-from-Vercel rate limiting) so the admin IP allowlist can't be spoofed the same way.

## 3. Bring up just the backend (not web/admin — Vercel serves those)

```bash
cd /opt/forest/app
infra/deploy/compose.sh build postgres migrate api
infra/deploy/compose.sh up -d --wait postgres redis storage
infra/deploy/compose.sh run --rm --no-deps migrate
docker exec -i "$(infra/deploy/compose.sh ps -q postgres)" psql -X -q -U forest -d forest \
  -v ON_ERROR_STOP=1 -v app_password="$FOREST_APP_DB_PASSWORD" -v ro_password="" \
  -f - <infra/deploy/db-roles.sql
infra/deploy/compose.sh up -d api
infra/deploy/compose.sh up -d --no-deps caddy
```
`--no-deps` on the last line matters: without it, Compose would also start `web`/`admin` because
Caddy depends on them — we don't want those running here. Caddy will log (harmless) certificate
errors for `SITE_DOMAIN`/`ADMIN_DOMAIN` since nothing serves them yet; ignore that for now.

Check it worked (use the same `$IP_DASHED` from step 2):
```bash
curl -s https://api.$IP_DASHED.nip.io/ready    # expect {"status":"ok", ...}
infra/deploy/compose.sh ps
```
If `/ready` doesn't answer: `infra/deploy/compose.sh logs --tail 100 caddy` and `... api` — share
the output.

## 4. Seed (owner account, settings, sample catalog)

```bash
infra/deploy/compose.sh run --rm --no-deps -e S3_ENDPOINT=http://storage:8333 \
  -w /repo/packages/db migrate sh -c 'node_modules/.bin/tsx src/seed/index.ts --allow-production'
```

## 5. Vercel: web + admin

The `forest-demo-web` / `forest-demo-admin` Vercel projects already exist (created earlier, not
yet deployed). For each:

1. Project → Settings → **Git**: connect `Elmun-Technologies/forest.uz`, Production Branch `main`.
2. Settings → **Build and Deployment**: Framework **Next.js**, Root Directory `apps/web` (or
   `apps/admin`), Node.js **22.x**.
3. Settings → **Environment Variables** (Production) — use the same `$IP_DASHED` value from step 2:

| Variable | web | admin |
|---|---|---|
| `API_INTERNAL_URL`, `API_URL` | `https://api.<ip-dashed>.nip.io` | same |
| `APP_URL` | this project's own Vercel URL | this project's own Vercel URL |
| `S3_PUBLIC_URL` | `https://cdn.<ip-dashed>.nip.io/forest-public` | same |
| `EDGE_PROXY_SECRET` (Sensitive) | the value generated in step 2 | same |
| `WEB_REVALIDATE_SECRET` (Sensitive) | the value generated in step 2 | — |
| `WEB_INTERNAL_URL` | — | the **web** project's Vercel URL (heatmap backdrops) |

4. Deploy (Deployments → trigger one, or just push to `main`).
5. Note each project's production URL (Project → Domains) — this is what you'll actually share
   today; a custom domain for these is a separate, later step.

## 6. Wire the two sides together

Back on the server:
```bash
cd /opt/forest/app
sed -i \
  -e 's#^APP_URL=.*#APP_URL=https://<web-vercel-url>#' \
  -e 's#^WEB_INTERNAL_URL=.*#WEB_INTERNAL_URL=https://<web-vercel-url>#' \
  -e 's#^ADMIN_URL=.*#ADMIN_URL=https://<admin-vercel-url>#' \
  .env
infra/deploy/compose.sh up -d api   # picks up the new .env
```

## 7. Log in, lock the account down

Open the **admin** Vercel URL, log in with `OWNER_EMAIL` / the password from step 2, enrol TOTP
when forced, change the password. Only then share the **web** URL with anyone.

## 8. Verify the client-IP setup actually works

From Wi-Fi, request OTP codes on the storefront for six made-up numbers
(`+998 90 000 00 01` … `06`) — `OTP_POLICY` allows 5 sends/hour per IP, so the sixth must be
refused. From a phone on mobile data, request one for `+998 90 000 00 07`: it must succeed. If
it's refused too, everyone is sharing one IP — check `EDGE_PROXY_SECRET` matches on both Vercel
projects and the server's `.env`, and that `TRUST_PROXY_HOPS=2` on the server.

Read a sent code (testing only, made-up numbers): `https://api.<ip-dashed>.nip.io/v1/dev/outbox?to=%2B998900000001`.

## 9. What's deliberately deferred

- A real domain (swap `*.nip.io` for it later: three `sed` lines in step 2, one in each Vercel
  project's env, redeploy `caddy` and `api` — no code change, no data migration).
- Real Payme/Click/Eskiz/Telegram/Yandex/MoySklad credentials (Admin → Integrations, whenever
  ready — the site runs on fakes until then).
- Backups, monitoring, the `forest_ro` read-only role, the sample catalog swap — same list as
  `docs/launch-checklist.md`; none of them block today's launch.
- Moving web/admin onto this same server (drop the Vercel split, use `deploy-and-rollback.md`
  as-is) and tightening `TRUSTED_PROXIES` back down when you do.
- The PII/hosting-location point from the top of this file.

## 10. Redeploying the API after a code change

```bash
cd /opt/forest/app && git pull
infra/deploy/compose.sh build api && infra/deploy/compose.sh up -d api
```
A new migration: re-run the `migrate` command from step 3 first.
