# Runbook · secret and key rotation

Rotate on a schedule (yearly), when someone with access leaves, and **immediately** after a
suspected leak. Generate every new value on the server (`openssl rand …`), never paste secrets into
chat/tickets, update the owner's password-manager copy, then `infra/deploy/deploy.sh` (all
containers read `.env` at start). Record the rotation (date, who, why) in the ops log.

## Inventory — what each secret protects and what breaks when it changes

| Secret | Where | Protects | Effect of changing it |
|---|---|---|---|
| `APP_ENCRYPTION_KEY` | `.env` (api) | AES-256-GCM envelopes: integration credentials, staff TOTP secrets, outbound-webhook secrets (`SecretBox`); Yandex callback `key` (HMAC) | **see §1 — not rotatable in place today** |
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

**Current state (verified in code, 2026-10-27):** `SecretBox` supports a keyring (current +
previous keys, key id in every envelope; `needsRotation()`), but every construction site passes only
`current` (`integrations.service.ts`, `admin-auth.service.ts`, `webhook-secrets.ts`,
`dev-admin.controller.ts`) and no env variable carries previous keys, and nothing re-encrypts rows.
Changing the key therefore makes every stored credential, every staff TOTP secret and every outbound
webhook secret undecryptable ("unknown encryption key id"), and changes the Yandex callback key.
This is finding **F-02** in docs/security/asvs-l2.md (fix: `APP_ENCRYPTION_KEY_PREVIOUS` comma list
passed to all `SecretBox`es + a one-off re-encryption command using `needsRotation`).

Until that fix ships, rotate only after a suspected leak, as a planned maintenance:
1. Export nothing — the plaintexts must be re-entered from the providers' cabinets anyway (a leaked
   master key means the DB copies of the credentials must be considered leaked: **rotate them at the
   providers first**, §6).
2. Set the new key in `.env`, deploy.
3. Owner re-enters every integration's credentials in Admin → Integrations (new values from §6),
   reconnects Telegram/Eskiz/MoySklad (new webhook tokens), re-registers the Yandex callback.
4. Reset TOTP of every staff member (Admin → Staff → reset TOTP); everyone enrols again.
5. Rotate every outbound webhook secret; tell partners.

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
