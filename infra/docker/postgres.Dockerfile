# Production PostgreSQL 16: the official alpine image + pgBackRest (Alpine community package) for
# physical backups and WAL archiving (CLAUDE.md §6, docs/runbooks/restore-db.md). Same major and
# extensions as dev/CI (pg_trgm, unaccent ship with the image).
# Build: docker build -f infra/docker/postgres.Dockerfile -t forest-postgres:16 .
FROM postgres:16-alpine
RUN apk add --no-cache pgbackrest \
  && install -d -o postgres -g postgres -m 750 /var/spool/pgbackrest /var/log/pgbackrest /etc/pgbackrest
COPY infra/backup/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY --chmod=755 infra/docker/postgres-entrypoint.sh /usr/local/bin/forest-postgres-entrypoint
ENTRYPOINT ["forest-postgres-entrypoint"]
CMD ["postgres"]
