-- Production database roles (CLAUDE.md §6 "DB roles in production"; docs/14 least privilege +
-- immutable audit log). Idempotent: infra/deploy/deploy.sh runs it as the owner `forest` after
-- every `prisma migrate deploy`, so tables added by new migrations get their grants and the
-- AuditLog revoke is re-applied. Not a Prisma migration: role passwords are per install.
--
--   psql -v ON_ERROR_STOP=1 -v app_password="$FOREST_APP_DB_PASSWORD" \
--        -v ro_password="$FOREST_RO_DB_PASSWORD" -f infra/deploy/db-roles.sql
--
-- forest      owner: migrations, seed, backups (POSTGRES_USER of the container)
-- forest_app  the API: DML on every table, sequences, functions; no DDL; AuditLog append-only
-- forest_ro   read-only (support queries, ad-hoc analytics); NOLOGIN unless ro_password is set
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE forest_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'forest_app') \gexec
SELECT format('ALTER ROLE forest_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'app_password') \gexec

SELECT 'CREATE ROLE forest_ro NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'forest_ro') \gexec
SELECT CASE WHEN :'ro_password' = '' THEN 'ALTER ROLE forest_ro NOLOGIN'
            ELSE format('ALTER ROLE forest_ro LOGIN PASSWORD %L', :'ro_password') END \gexec

-- Statement statistics for the slow-query review (shared_preload_libraries in compose.prod.yml).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE forest TO forest_app;
GRANT CONNECT ON DATABASE forest TO forest_ro;
GRANT USAGE ON SCHEMA public, event_parts TO forest_app, forest_ro;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO forest_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO forest_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO forest_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public, event_parts TO forest_ro;
-- Partitions are written through the parent "Event"; reads of a partition itself (the default-
-- partition watchdog `event_default_partition_rows()`) need SELECT on event_parts.
GRANT SELECT ON ALL TABLES IN SCHEMA event_parts TO forest_app;

-- Tables/sequences that later migrations (run as forest) create.
ALTER DEFAULT PRIVILEGES FOR ROLE forest IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO forest_app;
ALTER DEFAULT PRIVILEGES FOR ROLE forest IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO forest_app;
ALTER DEFAULT PRIVILEGES FOR ROLE forest IN SCHEMA public
  GRANT SELECT ON TABLES TO forest_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE forest IN SCHEMA event_parts
  GRANT SELECT ON TABLES TO forest_ro, forest_app;

-- Audit log is append-only for the application (docs/14). Re-applied after the blanket grant.
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM forest_app;
-- Prisma's migration bookkeeping is the owner's business.
REVOKE INSERT, UPDATE, DELETE ON "_prisma_migrations" FROM forest_app;

-- The app creates monthly Event partitions (boot + daily job) but must not own tables: run the
-- helper with the owner's rights, with a fixed search_path (SECURITY DEFINER hygiene).
ALTER FUNCTION ensure_event_partitions(integer) SECURITY DEFINER;
ALTER FUNCTION ensure_event_partitions(integer) SET search_path = public, event_parts, pg_temp;
REVOKE ALL ON FUNCTION ensure_event_partitions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_event_partitions(integer) TO forest_app;
DO $$
BEGIN
  IF to_regprocedure('drop_old_event_partitions(integer)') IS NOT NULL THEN
    ALTER FUNCTION drop_old_event_partitions(integer) SECURITY DEFINER;
    ALTER FUNCTION drop_old_event_partitions(integer) SET search_path = public, event_parts, pg_temp;
    REVOKE ALL ON FUNCTION drop_old_event_partitions(integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION drop_old_event_partitions(integer) TO forest_app;
  END IF;
END $$;
COMMIT;

-- Evidence for the deploy log / launch checklist.
SELECT 'AuditLog privileges of forest_app' AS check,
       string_agg(privilege_type, ',' ORDER BY privilege_type) AS granted
FROM information_schema.role_table_grants
WHERE grantee = 'forest_app' AND table_name = 'AuditLog';
