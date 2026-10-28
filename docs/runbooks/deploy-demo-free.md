# Runbook · free demo (Render + Supabase + Vercel Hobby)

A zero-cost, internet-reachable **demo** for showing the shop before the UZ VPS exists. Same
rules as the Fly demo (`deploy-demo.md`): fake providers, **seed/synthetic data only, never real
customer names, phones or addresses**. Production stays on the UZ VPS (CLAUDE.md §15; PII
localisation law).

```
Browser ──► Vercel: web  (Root Directory apps/web)   ──/api/* rewrite──┐
        └─► Vercel: admin (Root Directory apps/admin) ─/api/* rewrite──┤
                                                                       ▼
                 Render free (frankfurt): forest-demo-api (NestJS + BullMQ, render.yaml)
                        │  └── Render Key Value free: forest-demo-redis (25 MB, in memory)
                        ├──► Supabase Postgres (session pooler, IPv4)
                        └──► Supabase Storage S3: forest-public (public) / forest-private
```

## 1. Limits you accept (free tiers)

| Piece | Limit | Effect on the demo |
|---|---|---|
| Render free web service | sleeps after 15 min without requests; 512 MB RAM, 0.1 CPU; 750 instance-hours/month per workspace | `.github/workflows/demo-keepalive.yml` pings `/ready` every 10 min (GitHub may delay a run; then the first request takes ~1 min). Keep only this one free service running all month. Pages are slower than on the VPS. |
| Render Key Value free | 25 MB, no persistence | A restart loses carts' Redis state, sessions (everyone logs in again) and queued jobs; repeatable jobs are re-registered on boot. `JOBS_KEEP_COMPLETED=50`/`JOBS_KEEP_FAILED=200` keep BullMQ small. |
| Render free deploys | no pre-deploy command, no Dockerfile target choice | Migrations and the seed run from a laptop (§3). Render builds the `runtime` stage. |
| Supabase free | 500 MB database, 1 GB storage; project pauses after 7 idle days | The keep-alive's `/ready` queries the database. Delete old demo data rather than upgrading. |
| Vercel Hobby | non-commercial use only | Fine for showing the project; a commercial demo belongs on Pro. |

## 2. Supabase (database + storage)

1. supabase.com → New project, region **Central EU (Frankfurt)**, a strong database password
   (keep it in your password manager).
2. **Database URL:** Project → *Connect* → **Session pooler** (IPv4; the direct host is IPv6-only
   and Render can't reach it). Append `?connection_limit=5`:
   `postgresql://postgres.<ref>:<password>@aws-…-eu-central-1.pooler.supabase.com:5432/postgres?connection_limit=5`.
3. **Buckets:** Storage → New bucket `forest-public` with *Public bucket* **on**; `forest-private`
   with it **off**.
4. **S3 keys:** Project Settings → Storage → *S3 Connection*: note the endpoint
   (`https://<ref>.storage.supabase.co/storage/v1/s3`) and region (`eu-central-1`), then
   *New access key* (the secret is shown once).
5. Public URL of the images: `https://<ref>.supabase.co/storage/v1/object/public/forest-public`.

## 3. Migrations + seed (from the repo on your laptop)

Create `.env.demo` in the repo root (ignored by git like every `.env.*`; never commit or paste it):

```bash
DATABASE_URL='postgresql://postgres.<ref>:<password>@<pooler host>:5432/postgres?connection_limit=5'
S3_ENDPOINT=https://<ref>.storage.supabase.co/storage/v1/s3
S3_REGION=eu-central-1
S3_FORCE_PATH_STYLE=true
S3_BUCKET_PUBLIC=forest-public
S3_BUCKET_PRIVATE=forest-private
S3_ACCESS_KEY=<access key id>
S3_SECRET_KEY=<secret>
OWNER_EMAIL=<your e-mail>
OWNER_INITIAL_PASSWORD=<generate: openssl rand -base64 18>
```

```bash
cd packages/db
pnpm exec dotenv -e ../../.env.demo -- prisma migrate deploy
pnpm exec dotenv -e ../../.env.demo -- tsx src/seed/index.ts
cd ../..
```

Only `.env.demo` is loaded (not your local `.env`), so nothing points at localhost. Re-run
`migrate deploy` whenever a new migration lands on `main` **before** Render deploys it (the API
of a newer commit expects the new schema). The seed is idempotent.

## 4. Render (API + Redis)

1. render.com → sign in with GitHub → **New → Blueprint** → this repository, branch `main`.
   Render reads `render.yaml`: web service `forest-demo-api` (Docker, free, Frankfurt) and Key Value
   `forest-demo-redis` (free, `noeviction`, internal only).
2. It asks for the `sync: false` values:
   - `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_URL`
     — from §2;
   - `APP_URL` and `WEB_INTERNAL_URL` = storefront Vercel URL, `ADMIN_URL` = admin Vercel URL
     (`https://<project>.vercel.app`, Vercel → Project → Domains);
   - `API_URL` = `https://forest-demo-api.onrender.com` (the service URL Render shows; use the real
     one if the name was taken).
3. Render generates `APP_ENCRYPTION_KEY`, `SESSION_SECRET`, `WEB_REVALIDATE_SECRET`,
   `EDGE_PROXY_SECRET`, `TELEGRAM_WEBHOOK_SECRET`. `APP_ENCRYPTION_KEY` stays on Render only.
4. After the first deploy `https://<api>.onrender.com/ready` answers `{"status":"ok",…}`.
   Deploys follow `main` after CI passes (`autoDeployTrigger: checksPass`) and only when API-side
   paths changed (`buildFilter`).

## 5. Vercel (storefront + admin)

For each project (`forest-demo-web` → Root Directory `apps/web`, `forest-demo-admin` → `apps/admin`):

1. Settings → Git → connect this repository; Production Branch `main`.
2. Settings → Build and Deployment: Framework **Next.js**, Root Directory as above, Node.js
   **22.x**; *Ignored Build Step* → custom command `[ "$VERCEL_GIT_COMMIT_REF" != "main" ]`
   (only `main` builds; branch previews would have no API).
3. Settings → Environment Variables (Production):

| Variable | web | admin |
|---|---|---|
| `API_INTERNAL_URL`, `API_URL` | Render API URL | Render API URL |
| `APP_URL` | storefront URL | storefront URL |
| `S3_PUBLIC_URL` | public bucket URL (§2.5; `next/image` pattern, build time) | same (admin CSP media origin, build time) |
| `EDGE_PROXY_SECRET` (Sensitive) | copy of Render's value | copy of Render's value |
| `WEB_REVALIDATE_SECRET` (Sensitive) | copy of Render's value | — |
| `WEB_INTERNAL_URL` | — | storefront URL (heatmap backdrops) |

   Never add `APP_ENCRYPTION_KEY` to Vercel.
4. Deployments → *Redeploy* (env changes need a new build: Next bakes the rewrites and the
   image/CSP origins at build time).

Do **not** also run the Fly workflow (`deploy-demo.yml`) against the same Vercel projects.

## 6. After the first deploy

1. **Owner first:** open the admin URL, log in with `OWNER_EMAIL` / `OWNER_INITIAL_PASSWORD`, set
   up TOTP and change the password **before sharing any link**.
2. **Keep-alive:** GitHub → Settings → Secrets and variables → Actions → *Variables* →
   `FREE_DEMO_API_URL` = the Render API URL. Run *Free demo keep-alive* once by hand (Actions tab).
3. **Client IP check** (rate limits key on it; `OTP_POLICY`: 5 code sends per IP per hour): on
   the storefront login page, from Wi-Fi, request codes for six made-up numbers
   (`+998 90 000 00 01` … `06`) — the sixth must be refused. Then, from a phone on mobile data,
   request one for `+998 90 000 00 07`: it must get a code. If it is refused too, every visitor
   shares one IP (Render added more than one proxy hop): set `TRUST_PROXY_HOPS=3` on the Render
   service and repeat with new numbers.
4. Testers read their code from `https://<api>/v1/dev/outbox?to=%2B998900000001` (fake SMS) — only
   made-up numbers.

## 7. Troubleshooting

- **Render build/start fails "Invalid environment":** the log names the variable (e.g. a missing
  `DATABASE_URL`).
- **`/ready` 503:** database or Redis unreachable — check the pooler URL (session pooler, port
  5432) and that `forest-demo-redis` is in Frankfurt like the API.
- **Images broken on the storefront:** `S3_PUBLIC_URL` differs between Render and Vercel, or the
  web was not rebuilt after setting it; `forest-public` must be a public bucket.
- **Admin login always fails with a CSRF/Origin error:** `ADMIN_URL` on Render must be the admin's
  exact production URL (no trailing slash, not a preview URL).
- **Supabase paused** (after a keep-alive outage): Supabase dashboard → *Restore project*.
