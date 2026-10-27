#!/usr/bin/env bash
# pgBackRest wrapper (systemd timer forest-pgbackrest, docs/runbooks/restore-db.md). Runs inside
# the production postgres container (infra/docker/postgres.Dockerfile), which has the repository
# credentials in its environment.
#
# Usage: infra/backup/pgbackrest.sh <command>
#   init        stanza-create + check (once, after the first deploy with .env.ops filled in)
#   backup      full on Sunday (Asia/Tashkent), differential otherwise; then check; Sunday also verify
#   full|diff   force a backup type
#   check       archive_command works and the newest WAL reached the repository
#   info        backups and the WAL range available for PITR
. "$(dirname "$0")/lib.sh"
trap_alert pgbackrest

pg="$(service_container postgres)"
pbr() { docker exec -u postgres "$pg" pgbackrest --stanza=forest "$@"; }

docker exec "$pg" sh -c '[ -n "$PGBACKREST_REPO1_S3_BUCKET" ]' ||
  die "PGBACKREST_* not set in the postgres container (fill .env.ops and redeploy)"

case "${1:-backup}" in
  init)
    pbr stanza-create
    pbr check
    ;;
  backup)
    if [[ "$(TZ=Asia/Tashkent date +%u)" == 7 ]]; then type=full; else type=diff; fi
    log "pgBackRest ${type} backup"
    pbr --type="$type" backup
    pbr check
    [[ "$type" == full ]] && pbr verify
    mkdir -p "$BACKUP_DIR"
    date -u +%Y-%m-%dT%H:%M:%SZ >"$BACKUP_DIR/PGBACKREST_LAST_SUCCESS"
    heartbeat pgbackrest
    ;;
  full | diff) pbr --type="$1" backup ;;
  check) pbr check ;;
  info) pbr info ;;
  *) die "unknown command $1" ;;
esac
