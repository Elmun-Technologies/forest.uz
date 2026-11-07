# Runbook · Hetzner VPS quickstart (launch today)

Full reference is `docs/runbooks/deploy-and-rollback.md` — this file is the condensed, in-order
path from an empty Hetzner server to a live site today, using the same `infra/compose.yml` /
`infra/deploy/deploy.sh` the project already ships (no new infra code needed).

> **One fact to decide on, not to skip.** CLAUDE.md §15 and the demo runbooks say production must
> run on a server physically **in Uzbekistan** (personal-data localisation law, art. 27¹) because
> it will hold real customers' phones/addresses. **Hetzner has no Uzbekistan region** — its
> locations are Germany, Finland, the US and Singapore. Launching on Hetzner today is fine for
> getting the site live, testing, and demoing — but putting *real* customer PII (real phone
> numbers, real orders with real addresses) on it is the same legal exposure the project's own
> docs were written to avoid. Two honest paths:
> - **Launch today in `PROVIDERS_MODE=fake`** (`--allow-fake` below): a fully working site/admin on
>   your own domain, fake payments/SMS, synthetic or no real customer data. Move to UZ hosting
>   (or get legal sign-off on Hetzner) before taking real orders.
> - **Launch today for real** (`PROVIDERS_MODE=sandbox`/`live`) knowing it is out of policy until
>   that's resolved.
>
> This is your call, not mine to block — just make it knowingly. Record whichever you pick in
> CLAUDE.md §6 (a line is already queued for this; see the end of this file).

## 0. What you give me

- Server IP (and whether it's already provisioned, or I walk you through `hcloud`/the Hetzner
  Cloud console creating it: **CPX21** or better — 3 vCPU / 4 GB is tight; 4 vCPU / 8 GB is the
  documented minimum — Ubuntu 24.04, a region close to your users e.g. `fsn1`/`hel1`).
- root SSH access (password or a key you've added in the Hetzner console).
- Three DNS names pointed at that IP before step 3 (A records, no proxy/CDN in front yet):
  `forest.example.com` (site), `admin.forest.example.com`, `api.forest.example.com`. Use your real
  domain — Caddy needs these to get Let's Encrypt certificates.

## 1. First login, lock the door

```bash
ssh root@<server-ip>
apt-get update && apt-get -y upgrade
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

## 2. Docker + the repo

```bash
curl -fsSL https://get.docker.com | sh
mkdir -p /opt/forest && cd /opt/forest
git clone https://github.com/Elmun-Technologies/forest.uz app && cd app
git checkout main   # or the branch you want live
```

## 3. `.env` (generate every secret on the server, never reuse a dev value)

```bash
cd /opt/forest/app
cp .env.example .env
chmod 600 .env

# Fill the three domains and URLs (edit, or run these seds with your real domain):
sed -i \
  -e 's#^APP_URL=.*#APP_URL=https://forest.example.com#' \
  -e 's#^ADMIN_URL=.*#ADMIN_URL=https://admin.forest.example.com#' \
  -e 's#^API_URL=.*#API_URL=https://api.forest.example.com#' \
  -e 's#^SITE_DOMAIN=.*#SITE_DOMAIN=forest.example.com#' \
  -e 's#^ADMIN_DOMAIN=.*#ADMIN_DOMAIN=admin.forest.example.com#' \
  -e 's#^API_DOMAIN=.*#API_DOMAIN=api.forest.example.com#' \
  .env

# Generate every secret (prints them; they land straight in .env below — copy APP_ENCRYPTION_KEY
# somewhere safe too, e.g. your password manager: losing it loses integration credentials + TOTP).
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
SESSION_SECRET=$(openssl rand -hex 32)
WEB_REVALIDATE_SECRET=$(openssl rand -hex 32)
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
  -e "s#^TELEGRAM_WEBHOOK_SECRET=.*#TELEGRAM_WEBHOOK_SECRET=$TELEGRAM_WEBHOOK_SECRET#" \
  -e "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$POSTGRES_PASSWORD#" \
  -e "s#^FOREST_APP_DB_PASSWORD=.*#FOREST_APP_DB_PASSWORD=$FOREST_APP_DB_PASSWORD#" \
  -e "s#^S3_ACCESS_KEY=.*#S3_ACCESS_KEY=$S3_ACCESS_KEY#" \
  -e "s#^S3_SECRET_KEY=.*#S3_SECRET_KEY=$S3_SECRET_KEY#" \
  -e "s#^OWNER_INITIAL_PASSWORD=.*#OWNER_INITIAL_PASSWORD=$OWNER_INITIAL_PASSWORD#" \
  -e 's#^OWNER_EMAIL=.*#OWNER_EMAIL=you@yourdomain.com#' \
  -e 's#^DATABASE_URL=.*#DATABASE_URL=postgresql://forest:'"$POSTGRES_PASSWORD"'@postgres:5432/forest#' \
  -e 's#^REDIS_URL=.*#REDIS_URL=redis://redis:6379#' \
  -e 's#^S3_ENDPOINT=.*#S3_ENDPOINT=http://storage:8333#' \
  -e 's#^S3_PUBLIC_URL=.*#S3_PUBLIC_URL=https://forest.example.com/media#' \
  -e 's#^S3_FORCE_PATH_STYLE=.*#S3_FORCE_PATH_STYLE=true#' \
  -e 's#^DEV_ENDPOINTS=.*#DEV_ENDPOINTS=false#' \
  .env

echo "owner password: $OWNER_INITIAL_PASSWORD"   # save this now, it is not shown again
```

Two choices this leaves open, pick one:

- **Fake providers today** (the first bullet in the warning above):
  ```bash
  sed -i -e 's#^PROVIDERS_MODE=.*#PROVIDERS_MODE=sandbox#' -e 's#^ALLOW_FAKE_PROVIDERS=.*#ALLOW_FAKE_PROVIDERS=true#' .env
  ```
  then always pass `--allow-fake` to `deploy.sh` below (actually keep `PROVIDERS_MODE=fake`
  instead of `sandbox` if you want *every* provider faked, not just the ones you haven't connected
  yet — `fake` is simplest for today).
  ```bash
  sed -i -e 's#^PROVIDERS_MODE=.*#PROVIDERS_MODE=fake#' .env
  ```
- **Real providers from day one:** leave `PROVIDERS_MODE=sandbox` and connect Payme/Click/Eskiz/etc
  in Admin → Integrations after login (never in `.env` — CLAUDE.md §13). Don't pass `--allow-fake`.

`CDN_DOMAIN` is optional (a separate domain serving the public bucket); leave it blank for today —
`S3_PUBLIC_URL` above already serves images through the site domain via Caddy.

Also copy the ops file (backups; can be filled in later, today's launch doesn't block on it):

```bash
cp infra/deploy/env.ops.example .env.ops && chmod 600 .env.ops
```

## 4. Preflight, build, deploy

```bash
infra/deploy/deploy.sh preflight            # add --allow-fake if you set PROVIDERS_MODE=fake above
```
Fix anything it lists (it tells you exactly which `.env` line is wrong), then:
```bash
infra/deploy/deploy.sh --allow-fake         # omit --allow-fake if PROVIDERS_MODE is sandbox/live
```
First run builds every image (~10 min). It migrates the database, starts everything, and waits for
`https://<site>`, `https://<api>/ready`, `https://<admin>/login` to answer through Caddy — so this
step alone proves DNS + Caddy + TLS worked. If it fails, it prints why; share that output with me.

## 5. Seed (owner account, settings, sample catalog)

```bash
infra/deploy/compose.sh run --rm --no-deps -e S3_ENDPOINT=http://storage:8333 \
  -w /repo/packages/db migrate sh -c 'node_modules/.bin/tsx src/seed/index.ts --allow-production'
```

## 6. Log in, lock the account down

1. Open `https://admin.forest.example.com`, log in with `OWNER_EMAIL` / the password printed in
   step 3, enrol TOTP when it's forced, then change the password.
2. Only after that: share the site/admin links.

## 7. What's deliberately deferred (not blocking today's launch)

- Real Payme/Click/Eskiz/Telegram/Yandex/MoySklad credentials — connect them in Admin →
  Integrations whenever ready; the site works with fakes until then.
- Backups (`infra/backup/*`, systemd timers) and monitoring (GlitchTip/Uptime Kuma) — do these in
  the next day or two (`docs/runbooks/restore-db.md`, `monitoring.md`); don't let them block go-live.
- Cloudflare in front — optional, `deploy-and-rollback.md` §5 covers it; needs `TRUST_PROXY_HOPS=2`
  + `TRUSTED_PROXIES`.
- Replacing the seeded sample catalog with the real one (`docs/launch-checklist.md`).
- The PII/hosting-location decision flagged at the top — resolve before real customer orders.

## 8. Regular deploys after today

Same as `deploy-and-rollback.md` §2: `git pull && infra/deploy/deploy.sh` (drop `--allow-fake` once
`PROVIDERS_MODE` is `sandbox`/`live`). Rollback: `infra/deploy/deploy.sh rollback`.
