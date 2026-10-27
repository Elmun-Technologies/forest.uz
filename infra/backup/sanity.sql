-- Restore drill sanity checks (infra/backup/restore-drill.sh). Read-only except for one
-- ensure_event_partitions() call, which runs inside a rolled-back transaction.
-- Prints one row per check: check | ok | detail. The drill fails when any ok = false.
-- psql variable: expected_migrations (number of migration folders in the deployed repo).
\set ON_ERROR_STOP on
\pset footer off

BEGIN;
-- The partition helper must still run (plpgsql + the parent table survived the restore).
SELECT ensure_event_partitions(1);

WITH checks(check_name, ok, detail) AS (
  SELECT 'migrations applied',
         count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = :expected_migrations
           AND count(*) FILTER (WHERE finished_at IS NULL) = 0,
         format('%s finished / %s expected, %s unfinished',
                count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
                :expected_migrations, count(*) FILTER (WHERE finished_at IS NULL))
  FROM _prisma_migrations
  UNION ALL
  SELECT 'extensions', count(*) = 2, string_agg(extname, ',')
  FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent')
  UNION ALL
  SELECT 'event partitions schema', count(*) >= 2, count(*) || ' partitions in event_parts'
  FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE i.inhparent = '"Event"'::regclass AND n.nspname = 'event_parts'
  UNION ALL
  SELECT 'invariant triggers', count(*) >= 3, string_agg(tgname, ',' ORDER BY tgname)
  FROM pg_trigger WHERE NOT tgisinternal
    AND tgname IN ('Payment_one_paid', 'Product_ikpu_guard', 'Variant_ikpu_guard')
  UNION ALL
  SELECT 'check constraints', count(*) >= 5, count(*) || ' CHECK constraints'
  FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE c.contype = 'c' AND n.nspname = 'public'
  UNION ALL
  SELECT 'catalog present', count(*) > 0, count(*) || ' active products'
  FROM "Product" WHERE status = 'ACTIVE'
  UNION ALL
  SELECT 'settings present', count(*) > 0, count(*) || ' setting rows' FROM "Setting"
  UNION ALL
  SELECT 'owner account', count(*) > 0, count(*) || ' active owners'
  FROM "Staff" WHERE role = 'OWNER' AND active
  UNION ALL
  SELECT 'order numbers vs sequence',
         coalesce(max(substring(number FROM 3)::bigint), 0) <= (SELECT last_value FROM order_number_seq),
         format('max F-%s, sequence %s', coalesce(max(substring(number FROM 3)::bigint), 0),
                (SELECT last_value FROM order_number_seq))
  FROM "Order" WHERE number ~ '^F-[0-9]+$'
  UNION ALL
  SELECT 'customer ids vs sequence',
         coalesce(max(substring("publicId" FROM 3)::bigint), 0) <= (SELECT last_value FROM customer_public_seq),
         format('max C-%s, sequence %s', coalesce(max(substring("publicId" FROM 3)::bigint), 0),
                (SELECT last_value FROM customer_public_seq))
  FROM "Customer" WHERE "publicId" ~ '^C-[0-9]+$'
  UNION ALL
  SELECT 'orders have items', count(*) = 0, count(*) || ' orders without items'
  FROM "Order" o WHERE NOT EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = o.id)
  UNION ALL
  SELECT 'one PAID payment per order', count(*) = 0, count(*) || ' orders with > 1 PAID payment'
  FROM (SELECT "orderId" FROM "Payment" WHERE status = 'PAID' GROUP BY 1 HAVING count(*) > 1) x
  UNION ALL
  SELECT 'stock non-negative', count(*) = 0, count(*) || ' variants with negative stock'
  FROM "Variant" WHERE stock < 0
  UNION ALL
  SELECT 'encrypted credentials intact', count(*) FILTER (WHERE credentials IS NOT NULL AND get_byte(credentials, 0) <> 1) = 0,
         count(*) FILTER (WHERE credentials IS NOT NULL) || ' integrations with credentials (envelope v1)'
  FROM "Integration"
)
SELECT check_name AS check, ok, detail FROM checks;

-- Row counts and freshness: recorded in the drill report (RPO evidence), not pass/fail.
SELECT 'Order' AS "table", count(*) AS rows, max("createdAt") AS latest FROM "Order"
UNION ALL SELECT 'Payment', count(*), max("createdAt") FROM "Payment"
UNION ALL SELECT 'Customer', count(*), max("createdAt") FROM "Customer"
UNION ALL SELECT 'AuditLog', count(*), max("createdAt") FROM "AuditLog"
UNION ALL SELECT 'Event', count(*), max(ts) FROM "Event"
UNION ALL SELECT 'Session', count(*), max("startedAt") FROM "Session"
UNION ALL SELECT 'IntegrationLog', count(*), max("createdAt") FROM "IntegrationLog";
ROLLBACK;
