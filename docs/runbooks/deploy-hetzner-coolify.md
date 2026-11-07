# Runbook · Hetzner backend via Coolify (web/admin stay on Vercel)

Supersedes the Caddy-based plan in `deploy-hetzner-quickstart.md` **for this specific server**: it
already runs **Coolify**, managing other projects (Gulf, and more coming) with its own Traefik
proxy on ports 80/443. We never run our own Caddy there — that would fight Coolify's proxy for
the same ports. Instead Forest becomes its own independent **Coolify Project**, using Coolify's
own domain/TLS handling, exactly like the owner's existing projects.

```
Browser ──► Vercel: web  (Root Directory apps/web)   ──/api/* rewrite──┐
        └─► Vercel: admin (Root Directory apps/admin) ─/api/* rewrite──┤
                                                                       ▼
     Hetzner VPS (shared with other Coolify projects — never touch their resources)
       Coolify's Traefik :80/:443 ──► Forest's api container (this project's private network)
                                              └──► postgres, redis, storage (same project only)
```

> Compliance note, unchanged: a VPS outside Uzbekistan doesn't satisfy the personal-data
> localisation rule (§15) once real customer PII is stored. `PROVIDERS_MODE=fake`, no real
> customer data, until that's resolved.
>
> **Shared-server rule:** everything below creates a new, independent "Forest" Project in
> Coolify and only ever edits resources inside it. Never open, stop, restart, or change the
> domain/ports of Gulf's (or any other existing project's) resources.

## 1. Create the project (Coolify UI, `http://2.29.137.243:8000`)

1. **Projects → + New Project** → name it `Forest`. Nothing else in Coolify is touched by this.
2. Inside it, **+ New Resource → Docker Compose**.
3. Source: **Git repository** → `https://github.com/Elmun-Technologies/forest.uz`, branch `main`.
4. **Base Directory**: `/` (repo root — the compose file's build context needs the whole repo).
5. **Docker Compose Location**: `infra/coolify/compose.yml`.

That file (`infra/coolify/compose.yml`, already in the repo) defines only `postgres`, `redis`,
`storage`, `api`, `migrate` — no `web`/`admin`/`caddy` (Vercel serves those) and **no published
host ports** (nothing here can collide with Gulf's or anyone else's ports on this server).

## 2. Environment Variables (this resource's own tab — not global, not Gulf's)

Generate these once anywhere you have `openssl` (your Mac is fine) and paste the **values** into
Coolify's Environment Variables tab for this resource, one per line as `KEY=value`:

```bash
openssl rand -base64 32   # → APP_ENCRYPTION_KEY
openssl rand -hex 32      # → SESSION_SECRET
openssl rand -hex 32      # → WEB_REVALIDATE_SECRET
openssl rand -hex 32      # → EDGE_PROXY_SECRET
openssl rand -hex 32      # → TELEGRAM_WEBHOOK_SECRET
openssl rand -hex 24      # → POSTGRES_PASSWORD
openssl rand -hex 12      # → S3_ACCESS_KEY
openssl rand -hex 24      # → S3_SECRET_KEY
openssl rand -base64 18   # → OWNER_INITIAL_PASSWORD (save this — needed in step 5)
```

Full variable list for the tab:

```
APP_ENCRYPTION_KEY=<generated>
SESSION_SECRET=<generated>
WEB_REVALIDATE_SECRET=<generated>
EDGE_PROXY_SECRET=<generated>
TELEGRAM_WEBHOOK_SECRET=<generated>
POSTGRES_PASSWORD=<generated>
S3_ACCESS_KEY=<generated>
S3_SECRET_KEY=<generated>
OWNER_EMAIL=you@yourdomain.com
OWNER_INITIAL_PASSWORD=<generated>
S3_PUBLIC_URL=            # fill in step 3, after Coolify gives the storage domain
APP_URL=                  # fill in step 4, after Vercel gives the web URL
WEB_INTERNAL_URL=         # same value as APP_URL
ADMIN_URL=                # fill in step 4, after Vercel gives the admin URL
API_URL=                  # fill in step 3, after Coolify gives the api domain
```

## 3. Domains (Coolify's "Add Domain", not Caddy)

After the first deploy attempt (it will partially fail until domains exist — that's expected),
open this resource's **Domains** tab:

- `api` service, port **4000** → Add Domain. No real domain needed: type
  `api.<server-ip-with-dashes>.nip.io` (e.g. server IP `2.29.137.243` →
  `api.2-29-137-243.nip.io`) — a free wildcard DNS service that resolves straight to that IP, no
  registration. Coolify issues it a real Let's Encrypt certificate itself.
- `storage` service, port **8333** → Add Domain the same way:
  `cdn.<server-ip-with-dashes>.nip.io`.

Set `.env` vars in Coolify accordingly (replace `<ip-dashed>` with the real dashed IP):
```
API_URL=https://api.<ip-dashed>.nip.io
S3_PUBLIC_URL=https://cdn.<ip-dashed>.nip.io/forest-public
```
Redeploy after saving. A real domain later is just swapping these two values and the matching
Coolify domain entries — nothing structural changes.

## 4. Vercel: web + admin

Same as `deploy-hetzner-quickstart.md` §5 — the `forest-demo-web` / `forest-demo-admin` Vercel
projects, Git-connected, Root Directory `apps/web` / `apps/admin`, Node 22.x. Env vars:

| Variable | web | admin |
|---|---|---|
| `API_INTERNAL_URL`, `API_URL` | `https://api.<ip-dashed>.nip.io` | same |
| `APP_URL` | this project's own Vercel URL | this project's own Vercel URL |
| `S3_PUBLIC_URL` | `https://cdn.<ip-dashed>.nip.io/forest-public` | same |
| `EDGE_PROXY_SECRET` (Sensitive) | the value from step 2 | same |
| `WEB_REVALIDATE_SECRET` (Sensitive) | the value from step 2 | — |
| `WEB_INTERNAL_URL` | — | the **web** project's Vercel URL |

Deploy, note each project's URL, then go back to Coolify's Environment Variables and fill in
`APP_URL`, `WEB_INTERNAL_URL` (= the web URL), `ADMIN_URL` (= the admin URL). Redeploy the `api`
service.

## 5. Seed (owner account, settings, sample catalog)

Coolify → this resource → `migrate` service (or `api`, if `migrate` already exited) → **Terminal**,
then:
```bash
cd /app/packages/db
node_modules/.bin/tsx src/seed/index.ts --allow-production
```
(The `migrate` container already ran the schema migration on deploy; this just inserts data.)

## 6. Log in, lock the account down

Open the admin Vercel URL, log in with `OWNER_EMAIL` / the `OWNER_INITIAL_PASSWORD` from step 2,
enrol TOTP when forced, change the password. Only then share the web URL.

## 7. What's deliberately deferred

- A real domain (step 3 already explains the swap).
- Real Payme/Click/Eskiz/Telegram/Yandex/MoySklad credentials (Admin → Integrations).
- Backups/monitoring/the `forest_ro` role/sample-catalog swap — `docs/launch-checklist.md`.
- The PII/hosting-location point at the top of this file.
- The ARM64 watch-item below.

## 8. If the `api` container fails to start: check for a Prisma/arm64 error

`packages/db/prisma/schema.prisma` lists `binaryTargets = ["native", "linux-musl-openssl-3.0.x",
"debian-openssl-3.0.x"]`. `"native"` resolves to whatever architecture the Docker **build** runs
on — since Coolify builds directly on this ARM64 (Ampere) server, that should already be
`linux-musl-arm64-openssl-3.0.x` and just work; the other two hardcoded names are x64-only and
simply unused here. This is believed fine, not verified on real ARM64 hardware. If `api`'s logs
show a Prisma "query engine not found for this platform" error, add
`"linux-musl-arm64-openssl-3.0.x"` to `binaryTargets` in a follow-up commit and redeploy — that's
the fix, not a sign the whole approach is wrong.
