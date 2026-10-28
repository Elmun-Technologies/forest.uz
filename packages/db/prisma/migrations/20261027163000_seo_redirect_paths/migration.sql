-- Redirect paths are stored canonical (no trailing slash except "/"), because lookups match both
-- slash variants: `/a/` → `/b` + `/b` → `/a` used to be storable and looped (CLAUDE.md §6).
-- 1. A slash variant whose canonical twin exists is redundant.
DELETE FROM "Redirect" r
WHERE r."from" <> '/' AND r."from" LIKE '%/'
  AND EXISTS (SELECT 1 FROM "Redirect" o WHERE o."from" = rtrim(r."from", '/'));
-- 2. Canonicalise both ends.
UPDATE "Redirect" SET "from" = rtrim("from", '/') WHERE "from" <> '/' AND "from" LIKE '%/';
UPDATE "Redirect" SET "to" = rtrim("to", '/') WHERE "to" <> '/' AND "to" LIKE '%/';
-- 3. Collapse chains the old exact-match logic let through, then drop self-redirects and cycles.
DO $$
BEGIN
  FOR i IN 1..20 LOOP
    UPDATE "Redirect" r SET "to" = o."to"
    FROM "Redirect" o
    WHERE r."to" = o."from" AND r."from" <> o."to" AND r."id" <> o."id";
    EXIT WHEN NOT FOUND;
  END LOOP;
END $$;
DELETE FROM "Redirect" WHERE "from" = "to";
DELETE FROM "Redirect" r WHERE EXISTS (SELECT 1 FROM "Redirect" o WHERE o."from" = r."to");
