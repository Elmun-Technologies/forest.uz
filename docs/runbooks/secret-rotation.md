# Runbook · secret and key rotation

Rotate on a schedule (yearly), when someone with access leaves, and **immediately** after a
suspected leak. Generate every new value on the server (`openssl rand …`), never paste secrets into
chat/tickets, update the owner's password-manager copy, then `infra/deploy/deploy.sh` (all
containers read `.env` at start). Record the rotation (date, who, why) in the ops log.

## Inventory — what each secret protects and what breaks when it changes

| Secret | Where | Protects | Effect of changing it |
|---|---|---|---|
| `APP_ENCRYPTION_KEY` (+ `APP_ENCRYPTION_KEY_PREVIOUS` during a rotation) | `.env` (api) | AES-256-GCM envelopes: integration credentials, staff TOTP secrets, outbound-webhook secrets (`SecretBox`); Yandex callback `key` (HMAC) | §1 — rotated in place (previous key + `rotate-keys`); Yandex callbacks of earlier claims stop matching |
| `SESSION_SECRET` | `.env` (api) | signed cookies (`fr_ord`), OTP hash pepper, Telegram deep links, cart-restore links (7 d), unsubscribe tokens in sent marketing SMS | §2 |
| `WEB_REVALIDATE_SECRET` | `.env` (api + web) | API → web revalidation, web → API 404 reports | §3 |
| `POSTGRES_PASSWORD` / `FOREST_APP_DB_PASSWORD` / `FOREST_RO_DB_PASSWORD` | `.env` | DB roles | §4 |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `.env` | app object storage (SeaweedFS config is generated from them by deploy.sh) | §5 |
| `TELEGRAM_WEBHOOK_SECRET` | `.env` | legacy/bootstrap; the bot's live webhook secret is generated per connect and stored encrypted | reconnect the Telegram integration |
| `DEV_ENDPOINTS_TOKEN`, `EDGE_PROXY_SECRET` | `.env` | demo/CI only — must be empty/unused on the VPS (`DEV_ENDPOINTS=false`) | — |
| Integration credentials (Payme/Click keys, MoySklad token, Eskiz password, Yandex OAuth, bot token, ad platforms, GSC/YWM) | DB, encrypted; Admin → Integrations (Owner) | provider access | §6 |
| Webhook path tokens (Eskiz callback, MoySklad webhook, Telegram webhook secret) | DB, generated on connect | inbound webhook auth | disconnect + connect the integration (new token), re-register webhooks (MoySklad `/moysklad`, Telegram automatic) |
| Outbound webhook secrets (`whsec_…`) | DB | partner signature checks | Admin → Integrations → Webhooks → rotate secret (shown once) |
| Partner API keys (`fk_live_…`) | DB (sha256 only) | partner API | create a new key, hand it over, revoke the old one |
| Staff passwords / TOTP | DB (argon2id / encrypted) | admin login | Owner: deactivate the person (kills sessions) or reset TOTP; staff change their own password |
| `BACKUP_ENCRYPTION_PASSPHRASE`, `PGBACKREST_REPO1_CIPHER_PASS` | `.env.ops` | backup encryption | §7 |
| `OPS_TELEGRAM_BOT_TOKEN` | `.env.ops` | ops alerts | same bot as the shop: rotate with BotFather, update both Admin → Integrations and `.env.ops` |
| GlitchTip `SECRET_KEY`, DB password | monitoring host `infra/monitoring/.env` | monitoring | restart the monitoring stack; users log in again |

## 1. `APP_ENCRYPTION_KEY` (master key)

Every `SecretBox` in the API (integration credentials — incl. the generated webhook path tokens —,
staff TOTP secrets, outbound-webhook secrets, the dev TOTP helper) uses one keyring:
`APP_ENCRYPTION_KEY` encrypts; it and every key in `APP_ENCRYPTION_KEY_PREVIOUS` (comma-separated,
optional, ≤ 5) decrypt — each envelope carries the id of the key that sealed it. The command
`node dist/scripts/rotate-keys.js` (in the api image; `pnpm --filter @forest/api rotate-keys` from a
built checkout with the env loaded) re-seals every value whose key id isn't the current key, one row
per short transaction under a row lock, and prints counts only (no ids, no values). It is idempotent:
a second run reports `rotated=0`. It exits 1 when some value was sealed with a key that is neither
current nor previous (`failed>0`) — don't drop the previous key then.

Procedure (planned maintenance, a few minutes, no downtime beyond the normal deploy):
1. **After a suspected leak**, first rotate the credentials at the providers (§6): a leaked master
   key means the DB copies of the credentials must be considered leaked too. Re-keying alone only
   protects what is stored from now on.
2. In `/opt/forest/app/.env`: move the current value to `APP_ENCRYPTION_KEY_PREVIOUS=<old>` and set
   `APP_ENCRYPTION_KEY=$(openssl rand -base64 32)`. Update the owner's password-manager copy (keep
   the old key there too until step 5).
3. `infra/deploy/deploy.sh` — the API now reads old envelopes with the previous key and writes new
   ones with the new key.
4. `infra/deploy/compose.sh exec api node dist/scripts/rotate-keys.js` — expect `failed=0` on every
   line; run it again: `rotated=0` everywhere.
5. Remove `APP_ENCRYPTION_KEY_PREVIOUS` from `.env`, deploy again. Delete the old key from the
   password manager once the next backups (which hold the re-sealed rows) exist; a DB restore from
   a backup older than step 4 needs the old key back in `APP_ENCRYPTION_KEY_PREVIOUS` (then run
   step 4 again).
6. **Yandex callback key**: the callback `key` is HMAC(`APP_ENCRYPTION_KEY`), so it changes at step
   3. Claims created before step 3 carry the old callback URL and their callbacks are refused (404);
   the `delivery` queue still polls those claims every minute, so status updates continue (up to
   ~1 min later). New claims get the new URL. If a callback URL is registered anywhere outside the
   claims (Yandex cabinet), copy the new one from Admin → Integrations → Yandex → "webhook URL"
   (Owner) — or reconnect the integration.
7. Record the rotation (date, who, why) in the ops log.

Nothing else depends on the master key in production (`WEB_REVALIDATE_SECRET` is separate; the
dev/test fallback derived from `APP_ENCRYPTION_KEY` is not used in production).

## 2. `SESSION_SECRET`

Changing it: OTP codes in flight (≤ 5 min) fail → customers request a new one; open order pages
lose the "placed in this browser" signed cookie (`fr_ord`, 24 h) → owner view needs login; cart
links (≤ 7 d) and bot deep links stop working; **unsubscribe links in marketing SMS already sent
stop working** (finding F-07: the unsubscribe verifier accepts a legacy format but no previous
secret). Customer and admin sessions are opaque Redis ids — not affected.
Procedure: pick a quiet hour, set the new value, deploy. For a leak, also rotate the marketing
opt-out promise by handling "STOP" replies manually for 30 days.

## 3. `WEB_REVALIDATE_SECRET`

Must be identical in api and web; both read `.env` → one deploy switches both. Between the api and
web container restarts (seconds) revalidations/404 reports are refused (fail closed); pages still
expire on their ISR window. No user impact.

## 4. Database passwords

- `FOREST_APP_DB_PASSWORD`: set the new value in `.env`, run `infra/deploy/deploy.sh` —
  `db-roles.sql` runs `ALTER ROLE forest_app … PASSWORD` before the API restarts with the new URL.
- `POSTGRES_PASSWORD` (owner): the container env only sets it at initdb. Change it in SQL first,
  then in `.env`, then deploy:
  `infra/deploy/compose.sh exec postgres psql -U forest -d forest -c "ALTER ROLE forest PASSWORD '<new>'"`
  (run from a root shell with history disabled: `set +o history`).

## 5. Object storage keys

Compose SeaweedFS: change `S3_ACCESS_KEY`/`S3_SECRET_KEY` in `.env`, deploy (deploy.sh regenerates
`infra/deploy/.secrets/seaweedfs-s3.json`; storage and api restart). UZ S3 provider: create the new
key in the provider console, put it in `.env`, deploy, then delete the old key.

## 6. Integration credentials (Owner, Admin → Integrations)

1. Create the new credential at the provider (Payme cabinet → cashbox key, Click → secret key,
   MoySklad → new token for the integration user, Eskiz → password, BotFather → `/revoke`, …).
2. Paste it in Admin → Integrations → the integration (blank secret fields keep the stored value —
   fill only what changes), "Test".
3. Revoke the old credential at the provider. Each save is audited (`integration.update`).
Payme rotates its key itself via `ChangePassword`, which updates our copy automatically (audited).

## 7. Backup passphrases

pgBackRest: `repo1-cipher-pass` can't change for an existing repository — create a new repo prefix
(`repo1-path=/pgbackrest-2026`) with the new passphrase, `pgbackrest.sh init` + `full`, keep the old
repo (and old passphrase) until its backups expire, then delete it. Dumps/objects: a new
`BACKUP_ENCRYPTION_PASSPHRASE` applies to new uploads; keep the old one until the old files age out
(30 days) — old files can only be decrypted with the old passphrase.
