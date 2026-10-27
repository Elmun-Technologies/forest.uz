# Runbook · backups, restore, PITR and the restore drill

Decision: CLAUDE.md §6 "Backups". Everything stays in Uzbekistan (docs/14 localisation): the
backup bucket is an S3-compatible bucket at a UZ provider, in a different data centre from the VPS.

| What | Tool | When (Asia/Tashkent) | Kept | Where |
|---|---|---|---|---|
| Physical backup + WAL (PITR) | pgBackRest (in the prod postgres image) | full Sun 03:00, diff daily 03:00, WAL continuously (`archive_timeout` 60 s) | 4 fulls ≈ 4–5 weeks | `s3://<bucket>/pgbackrest` (AES-256-CBC repo encryption) |
| Logical dump | `pg_dump -Fc` (`infra/backup/pg-dump.sh`) | daily 02:30 + before every migration | 7 d local, 30 d remote | `/var/backups/forest/pg`, `s3://<bucket>/pg/*.bin` (rclone crypt) |
| Object storage | rclone sync (`objects-backup.sh`) | daily 04:00 | changes/deletions 30 d | `s3://<bucket>/objects/{public,private,history}` (rclone crypt) |
| Session replays | — **excluded** | | 30 d in the live bucket only | consented, short-lived, not worth restoring |
| Redis | not backed up | | | queues/sessions/caches: rebuilt; customers log in again |
| Restore drill | `restore-drill.sh --from-remote` | 1st of the month 05:15 | report in `/var/backups/forest/drills` | |

RPO: ≈ 1 min (WAL) / ≤ 24 h if only dumps survive. RTO: minutes for the current data size (drill
report has the measured restore time; re-measure as data grows).

Erasure (docs/14 DSR): an erased customer survives in backups until they expire (≤ ~35 days for
pgBackRest, 30 days for dumps/objects). After a restore, **re-run the erasures** recorded in the
audit log since the backup time (`AuditLog.action = 'customer.erase'`).

## Setup (once per server)

1. Create the bucket at the UZ provider (versioning off; lifecycle rules not needed — the scripts
   prune), an access key limited to that bucket, and fill `.env.ops`
   (`infra/deploy/env.ops.example`). Generate `BACKUP_ENCRYPTION_PASSPHRASE` and
   `PGBACKREST_REPO1_CIPHER_PASS` on the server (`openssl rand -base64 48`) and store both in the
   owner's password manager — **without them no backup can be read**.
2. `infra/deploy/deploy.sh` (postgres restarts with archiving on once `PGBACKREST_REPO1_S3_BUCKET`
   is set; without it archiving stays off on purpose).
3. `infra/backup/pgbackrest.sh init` (stanza-create + check), `infra/backup/pgbackrest.sh full`.
4. `rclone` needs the bucket to exist: `infra/backup/pg-dump.sh` — first run uploads and verifies
   (`cryptcheck`).
5. Enable the systemd timers (deploy-and-rollback.md §1.8) and Uptime Kuma push monitors.

## Check backups

```bash
infra/backup/pgbackrest.sh info        # backups + WAL range = possible PITR window
infra/backup/pgbackrest.sh check       # archive_command works right now
ls -lt /var/backups/forest/pg | head   # newest dumps; LAST_SUCCESS marker
systemctl list-timers 'forest-*'
journalctl -u forest-backup-db -n 50
```
Failures post to the Telegram alerts group (`OPS_TELEGRAM_*`) and a missed heartbeat alerts in
Uptime Kuma.

## Restore the production database

Decide first: **PITR** (pgBackRest; any second within the window — use for "a deploy/bug/operator
destroyed data at 14:05") or **dump** (yesterday 02:30 state or the pre-migration dump; use when the
pgBackRest repo is unavailable).

0. Announce in the incident chat (incident-contacts.md). Note the target time (UTC!) from the
   deploy log / audit log.
1. Stop writers: `infra/deploy/compose.sh stop api web admin` (Caddy keeps serving its error page).
   Payme/Click retry their callbacks; Payme marks the cashbox unavailable meanwhile.
2. Keep the broken state for analysis: `infra/backup/pg-dump.sh --local-only`.
3. **Rehearse first** (no risk to production): `infra/backup/restore-drill.sh --pitr --target
   '2026-11-02 09:04:00+00' --keep` restores into a scratch container and runs the sanity checks;
   inspect the data with `docker exec -it <scratch> psql -U forest forest`.
4. PITR in place:
   ```bash
   infra/deploy/compose.sh stop postgres
   infra/deploy/compose.sh run --rm --no-deps --entrypoint sh postgres -c \
     "su-exec postgres pgbackrest --stanza=forest --delta --type=time \
        --target='2026-11-02 09:04:00+00' --target-action=promote restore"
   infra/deploy/compose.sh up -d postgres          # replays WAL up to the target, then promotes
   infra/backup/pgbackrest.sh check                # new timeline archives again
   ```
   Dump instead: `docker exec -i <postgres> psql -U forest -d postgres -c 'DROP DATABASE forest WITH (FORCE)' -c 'CREATE DATABASE forest OWNER forest'`,
   then `docker exec -i <postgres> pg_restore -U forest -d forest -j 4 --exit-on-error < <dump>`.
5. `infra/deploy/deploy.sh --tag $(cat .deploy/current)` (re-applies migrations newer than the
   restore point and the role grants, then health-checks).
6. Reconcile what happened after the restore point:
   - Payments: compare Payme `GetStatement` / Click cabinet for the gap with `Payment` rows
     (payment-incident.md §Reconcile) — money that moved must be re-recorded via the provider
     retrying or by staff.
   - MoySklad: `POST /v1/admin/moysklad/sync {scope:"all"}` (A13 sync button).
   - Orders created in the gap exist only in SMS/Telegram notifications and MoySklad; re-enter as
     phone orders if needed.
   - Re-run customer erasures recorded after the restore point.
7. Full pgBackRest backup right after: `infra/backup/pgbackrest.sh full`.

## Restore drill (monthly, scripted)

`infra/backup/restore-drill.sh [--dump FILE | --from-remote | --pitr [--target T]] [--keep]`
restores into a throw-away `postgres:16-alpine` container (dump modes: `--network none`, trust auth
inside the container only), runs `infra/backup/sanity.sql` and writes a report:

- all migrations of the deployed repo applied, none unfinished; `pg_trgm`, `unaccent` present;
- `Event` partitions in `event_parts` and `ensure_event_partitions()` runs (inside a rolled-back
  transaction); invariant triggers and CHECK constraints present;
- catalogue, settings and an active owner exist; order/customer number sequences ≥ the max used;
- every order has items; ≤ 1 PAID payment per order; no negative stock; integration credentials
  are v1 envelopes;
- row counts + newest timestamps of Order, Payment, Customer, AuditLog, Event, Session,
  IntegrationLog (RPO evidence) and the restore time (RTO evidence).

A sha256 mismatch, a pg_restore error or any failed check exits non-zero and alerts.

### Drill results

| Date | Mode | Source | Restore | Result |
|---|---|---|---|---|
| 2026-10-27 | dump (local) | dev DB, 420 KB dump, 15 MB DB | 1 s (5 s total) | 14/14 checks passed (15 migrations, 261 orders, 402 audit rows) |
| 2026-10-27 | `--from-remote` | same dump uploaded through rclone crypt to a scratch S3 bucket, `cryptcheck` 0 differences, downloaded + sha256 verified | 1 s (7 s total) | passed |
| 2026-10-27 | dump (local) | fresh dev dump after 3 new migrations | 4 s (16 s total, host loaded) | passed (18/18 migrations); an older dump correctly failed "migrations applied 15/18" |
| 2026-10-27 | negative | dump with a sha256 file that doesn't match | — | refused before restoring (checksum mismatch) |

Not run here: `--pitr` (the sandbox can't install pgBackRest — the Alpine mirror is blocked — so the
prod postgres image could not be built). Run it on staging before launch:
`infra/backup/pgbackrest.sh full`, write a marker row, note the time, write another,
`restore-drill.sh --pitr --target '<time>'` must show the first and not the second.

## Object storage restore

```bash
. infra/backup/lib.sh   # with .env.ops loaded
rclone_run copy bcrypt:objects/public live:forest-public      # whole bucket
rclone_run copy bcrypt:objects/history/2026-11-02/public/products live:forest-public/products  # older versions
```
(`S3_ENDPOINT_FOR_BACKUP` / `RCLONE_NETWORK` as for the backup job.) The private bucket's `replays/`
prefix is never in the backup.
