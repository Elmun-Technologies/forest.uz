#!/usr/bin/env bash
# Nightly logical backup (systemd timer forest-backup-db, docs/runbooks/restore-db.md).
#
#   pg_dump custom format (-Fc, compressed) from the running postgres container
#   → $BACKUP_DIR/pg/forest-<UTC>.dump + .sha256, verified with pg_restore --list
#   → encrypted copy to the UZ backup bucket (rclone crypt) unless --local-only
#   → prune: local copies older than BACKUP_LOCAL_DAYS (7), remote older than BACKUP_REMOTE_DAYS (30)
#
# The physical backup + WAL archive (PITR) is pgBackRest (pgbackrest.sh); this dump is the
# independent second copy: restorable into any Postgres 16, also table by table.
#
# Usage: infra/backup/pg-dump.sh [--local-only]
#   COMPOSE_PROJECT=forest (default) picks the postgres container; BACKUP_DIR=/var/backups/forest
. "$(dirname "$0")/lib.sh"
trap_alert backup-db

LOCAL_ONLY=false
[[ "${1:-}" == "--local-only" ]] && LOCAL_ONLY=true

mkdir -p "$BACKUP_DIR/pg"
chmod 700 "$BACKUP_DIR" "$BACKUP_DIR/pg"
umask 077

pg="$(service_container postgres)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/pg/forest-${stamp}.dump"
tmp="${out}.partial"
on_exit "rm -f '$tmp'"

log "dumping ${PG_DB} from container ${pg:0:12} → ${out}"
start=$(date +%s)
# --no-password: local socket trust inside the container. -Z 6: a good size/CPU trade-off.
docker exec "$pg" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc -Z 6 --no-password >"$tmp"
# A dump that pg_restore can't list is not a backup.
docker exec -i "$pg" pg_restore --list >/dev/null <"$tmp"
mv "$tmp" "$out"
(cd "$BACKUP_DIR/pg" && sha256sum "$(basename "$out")" >"$(basename "$out").sha256")
size=$(du -h "$out" | cut -f1)
log "dump ok: ${size} in $(($(date +%s) - start)) s"

if [[ "$LOCAL_ONLY" == false ]]; then
  log "uploading encrypted copy"
  rclone_run copy "/backup/pg/$(basename "$out")" bcrypt:pg/ --s3-no-check-bucket
  rclone_run copy "/backup/pg/$(basename "$out").sha256" bcrypt:pg/ --s3-no-check-bucket
  # Verify the remote copy decrypts to the same bytes (rclone crypt checks the MAC per block).
  rclone_run cryptcheck "/backup/pg/" bcrypt:pg/ --include "$(basename "$out")" --one-way
  rclone_run delete bcrypt:pg/ --min-age "${BACKUP_REMOTE_DAYS:-30}d"
fi

find "$BACKUP_DIR/pg" -name 'forest-*.dump*' -mtime +"${BACKUP_LOCAL_DAYS:-7}" -delete
# Last-success marker for the uptime monitor / restore drill (age check).
date -u +%Y-%m-%dT%H:%M:%SZ >"$BACKUP_DIR/pg/LAST_SUCCESS"
log "done"
