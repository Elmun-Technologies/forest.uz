#!/usr/bin/env bash
# Restore drill (monthly timer forest-restore-drill; docs/14 "monthly restore drill").
# Restores a backup into a throw-away Postgres 16 container with NO network, runs
# infra/backup/sanity.sql and writes a report to $BACKUP_DIR/drills/. Never touches the live DB.
#
# Usage:
#   infra/backup/restore-drill.sh                     newest local dump ($BACKUP_DIR/pg)
#   infra/backup/restore-drill.sh --dump FILE         a given pg_dump -Fc file
#   infra/backup/restore-drill.sh --from-remote       newest dump from the encrypted UZ bucket
#                                                     (proves the offsite copy decrypts + restores)
#   infra/backup/restore-drill.sh --pitr [--target 'YYYY-MM-DD HH:MM:SS+05']
#                                                     pgBackRest restore (latest or point in time)
#   --keep                                            leave the scratch container running
#
# Exit 0 = every sanity check passed. Times are reported (RTO evidence) with the newest
# Order/AuditLog/Event timestamps (RPO evidence).
. "$(dirname "$0")/lib.sh"
trap_alert restore-drill

MODE=dump DUMP="" TARGET="" KEEP=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump) DUMP="$2"; shift 2 ;;
    --from-remote) MODE=remote; shift ;;
    --pitr) MODE=pitr; shift ;;
    --target) TARGET="$2"; shift 2 ;;
    --keep) KEEP=true; shift ;;
    *) die "unknown argument $1" ;;
  esac
done

PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
# PITR needs pgBackRest inside the image: the production postgres image (infra/docker/postgres.Dockerfile).
PITR_IMAGE="${PITR_IMAGE:-${FOREST_IMAGE_PREFIX:-forest}-postgres:${FOREST_PG_TAG:-16}}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="forest-restore-drill-${stamp,,}"
mkdir -p "$BACKUP_DIR/drills"
report="$BACKUP_DIR/drills/${stamp}-${MODE}.txt"
migrations_dir="$FOREST_ROOT/packages/db/prisma/migrations"
expected=$(find "$migrations_dir" -mindepth 1 -maxdepth 1 -type d | wc -l)
[[ "$expected" -gt 0 ]] || die "no migrations found in $migrations_dir"

cleanup() {
  if [[ "$KEEP" == true ]]; then
    log "keeping container $name (docker rm -f $name)"
  else
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker volume rm "${name}-data" >/dev/null 2>&1 || true
  fi
}
on_exit cleanup

wait_ready() {
  for _ in $(seq 1 120); do
    # TCP, not the socket: the image's init phase runs a socket-only temporary server first.
    docker exec "$name" pg_isready -h 127.0.0.1 -U "$PG_USER" -d "$PG_DB" -q 2>/dev/null && return 0
    sleep 1
  done
  docker logs --tail 50 "$name" >&2 || true
  die "scratch postgres did not become ready"
}

t0=$(date +%s)
case "$MODE" in
  dump | remote)
    if [[ "$MODE" == remote ]]; then
      mkdir -p "$BACKUP_DIR/drill-download"
      on_exit "rm -rf '$BACKUP_DIR/drill-download'"
      latest="$(rclone_run lsf bcrypt:pg/ --include 'forest-*.dump' | sort | tail -n1)"
      [[ -n "$latest" ]] || die "no dump found in the backup bucket"
      log "downloading $latest"
      rclone_run copy "bcrypt:pg/$latest" /backup/drill-download/
      rclone_run copy "bcrypt:pg/$latest.sha256" /backup/drill-download/ || true
      DUMP="$BACKUP_DIR/drill-download/$latest"
    fi
    if [[ -z "$DUMP" ]]; then
      DUMP="$(ls -1t "$BACKUP_DIR"/pg/forest-*.dump 2>/dev/null | head -n1 || true)"
      [[ -n "$DUMP" ]] || die "no dump in $BACKUP_DIR/pg (run pg-dump.sh first)"
    fi
    [[ -f "$DUMP" ]] || die "dump $DUMP not found"
    if [[ -f "$DUMP.sha256" ]]; then
      (cd "$(dirname "$DUMP")" && sha256sum -c --quiet "$(basename "$DUMP").sha256") ||
        die "checksum mismatch for $DUMP"
    fi
    log "restoring $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1)) into $name"
    # --network none: the restored data (PII) can't leave the container; trust auth is then safe.
    docker run -d --name "$name" --network none \
      -e POSTGRES_USER="$PG_USER" -e POSTGRES_DB="$PG_DB" -e POSTGRES_HOST_AUTH_METHOD=trust \
      -v "${name}-data:/var/lib/postgresql/data" "$PG_IMAGE" >/dev/null
    wait_ready
    # Roles the production grants refer to (infra/deploy/db-roles.sql) so ACLs restore too.
    docker exec "$name" psql -q -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -c \
      "DO \$\$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='forest_app') THEN CREATE ROLE forest_app NOLOGIN; END IF;
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='forest_ro') THEN CREATE ROLE forest_ro NOLOGIN; END IF;
       END \$\$;"
    docker cp "$DUMP" "$name:/tmp/restore.dump"
    t1=$(date +%s)
    docker exec "$name" pg_restore -U "$PG_USER" -d "$PG_DB" --exit-on-error -j 4 /tmp/restore.dump
    restore_sec=$(($(date +%s) - t1))
    source_desc="$(basename "$DUMP")"
    ;;
  pitr)
    [[ -n "${PGBACKREST_REPO1_S3_BUCKET:-}" ]] || die "pgBackRest repo not configured in $OPS_ENV_FILE"
    log "pgBackRest restore (${TARGET:-latest}) into $name"
    docker volume create "${name}-data" >/dev/null
    restore_args=(--stanza=forest --pg1-path=/var/lib/postgresql/data --delta)
    if [[ -n "$TARGET" ]]; then
      restore_args+=(--type=time "--target=${TARGET}" --target-action=promote)
    fi
    t1=$(date +%s)
    # Recovery fetches WAL from the backup bucket (restore_command written by pgBackRest), so the
    # scratch cluster gets a network — its own bridge, nothing published. archive_mode=off: it must
    # never push WAL into the production repository.
    pbr_env=(--env-file <(env | grep -E '^PGBACKREST_'))
    pbr_conf=(-v "$FOREST_ROOT/infra/backup/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro")
    docker run --rm "${pbr_env[@]}" "${pbr_conf[@]}" -v "${name}-data:/var/lib/postgresql/data" \
      --entrypoint sh "$PITR_IMAGE" -c \
      'chown postgres:postgres /var/lib/postgresql/data && chmod 700 /var/lib/postgresql/data &&
       su-exec postgres pgbackrest "$@" restore' sh "${restore_args[@]}"
    docker network create "${name}-net" >/dev/null
    on_exit "docker network rm '${name}-net' >/dev/null 2>&1"
    docker run -d --name "$name" --network "${name}-net" --user postgres "${pbr_env[@]}" "${pbr_conf[@]}" \
      -v "${name}-data:/var/lib/postgresql/data" --entrypoint postgres "$PITR_IMAGE" \
      -D /var/lib/postgresql/data -c archive_mode=off >/dev/null
    wait_ready
    # Wait until recovery reached the target and the cluster was promoted.
    for _ in $(seq 1 300); do
      [[ "$(docker exec "$name" psql -tA -U "$PG_USER" -d "$PG_DB" -c 'SELECT pg_is_in_recovery()')" == f ]] && break
      sleep 2
    done
    restore_sec=$(($(date +%s) - t1))
    source_desc="pgBackRest ${TARGET:-latest}"
    ;;
esac

log "running sanity checks"
docker cp "$FOREST_ROOT/infra/backup/sanity.sql" "$name:/tmp/sanity.sql"
result="$(docker exec "$name" psql -X -U "$PG_USER" -d "$PG_DB" -v expected_migrations="$expected" -f /tmp/sanity.sql 2>&1)" ||
  { printf '%s\n' "$result" >&2; die "sanity.sql failed"; }

{
  echo "Forest restore drill ${stamp}"
  echo "source:        ${source_desc}"
  echo "mode:          ${MODE}"
  echo "image:         $([[ $MODE == pitr ]] && echo "$PITR_IMAGE" || echo "$PG_IMAGE")"
  echo "restore time:  ${restore_sec} s (total $(($(date +%s) - t0)) s)"
  echo "db size:       $(docker exec "$name" psql -tA -U "$PG_USER" -d "$PG_DB" -c "SELECT pg_size_pretty(pg_database_size(current_database()))")"
  echo
  printf '%s\n' "$result"
} | tee "$report"

# psql's aligned output: a failed check shows "| f |".
if grep -Eq '\|\s+f\s+\|' <<<"$result"; then
  die "sanity check failed — see $report"
fi
log "drill passed — report $report"
