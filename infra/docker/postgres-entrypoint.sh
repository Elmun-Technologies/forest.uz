#!/bin/sh
# Production postgres entrypoint (infra/docker/postgres.Dockerfile): turns WAL archiving to the
# pgBackRest repository on only when one is configured, then hands over to the official
# entrypoint. Without a repository the cluster runs exactly like postgres:16-alpine (archiving off,
# so missing backup settings can never fill the disk with unarchived WAL).
set -e
if [ "${1:-}" = postgres ] && [ -n "${PGBACKREST_REPO1_S3_BUCKET:-}" ]; then
  shift
  # archive_timeout: a WAL switch at least every 60 s when there is traffic → RPO ≤ ~1 min.
  set -- postgres \
    -c archive_mode=on \
    -c 'archive_command=pgbackrest --stanza=forest archive-push %p' \
    -c archive_timeout=60 \
    "$@"
fi
exec docker-entrypoint.sh "$@"
