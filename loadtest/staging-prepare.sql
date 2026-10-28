-- Load-test preparation — STAGING ONLY (README.md). Run as the owner role against a staging
-- database that was restored from a backup for this run and is thrown away afterwards:
--   docker exec -i <postgres> psql -U forest -d forest -v ON_ERROR_STOP=1 < loadtest/staging-prepare.sql
-- k6 orders hold stock (COD 24 h, online 30 min): give every active variant plenty of it so the
-- run measures the system, not OUT_OF_STOCK answers.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_setting('forest.allow_loadtest', true) IS DISTINCT FROM 'on'
     AND EXISTS (SELECT 1 FROM "Order" WHERE "createdAt" > now() - interval '30 days' AND source = 'web' AND "contactName" <> 'Yuklama Test') THEN
    RAISE EXCEPTION 'recent real orders found: is this production? (SET forest.allow_loadtest = on to override on staging)';
  END IF;
END $$;
UPDATE "Variant" SET stock = stock + 100000 WHERE active;
SELECT count(*) AS variants_topped_up FROM "Variant" WHERE active;
-- Afterwards: discard the database (preferred) or find the test orders by contactName = 'Yuklama Test'.
