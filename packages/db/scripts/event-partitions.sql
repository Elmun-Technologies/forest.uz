
-- ───────── Event partitions ─────────
-- Monthly partitions live in schema "event_parts" so Prisma (which manages "public") never sees
-- them as drift. A job calls ensure_event_partitions() daily; the DEFAULT partition is a safety
-- net that should stay empty (monitored).
CREATE SCHEMA IF NOT EXISTS event_parts;

CREATE OR REPLACE FUNCTION ensure_event_partitions(months_ahead integer DEFAULT 3)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  m date := date_trunc('month', now() AT TIME ZONE 'UTC')::date - interval '1 month';
  last date := date_trunc('month', now() AT TIME ZONE 'UTC')::date + make_interval(months => months_ahead);
  part text;
BEGIN
  WHILE m <= last LOOP
    part := format('event_%s', to_char(m, 'YYYY_MM'));
    IF to_regclass(format('event_parts.%I', part)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE event_parts.%I PARTITION OF public."Event" FOR VALUES FROM (%L) TO (%L)',
        part, m::timestamptz, (m + interval '1 month')::timestamptz
      );
    END IF;
    m := m + interval '1 month';
  END LOOP;
END $$;

-- Drops raw-event partitions older than the retention window (13 months by default).
CREATE OR REPLACE FUNCTION drop_old_event_partitions(keep_months integer DEFAULT 13)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  r record;
  cutoff text := 'event_' || to_char(date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => keep_months), 'YYYY_MM');
  dropped integer := 0;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'event_parts' AND tablename ~ '^event_\d{4}_\d{2}$' AND tablename < cutoff LOOP
    EXECUTE format('DROP TABLE event_parts.%I', r.tablename);
    dropped := dropped + 1;
  END LOOP;
  RETURN dropped;
END $$;

CREATE TABLE IF NOT EXISTS event_parts.event_default PARTITION OF public."Event" DEFAULT;
SELECT ensure_event_partitions(3);
