-- Tracker paths stored before `/obuna/<token>` (marketing opt-out) and `/c/<token>` (cart
-- restore) were masked by `scrubPath` (CLAUDE.md §6): replace the secret segment everywhere a
-- path was copied. Idempotent (`:token` never matches `[^/:]`).

UPDATE "Event"
SET "path" = regexp_replace("path", '(^|/)(obuna|c)/[^/:][^/]*', '\1\2/:token', 'g')
WHERE "path" ~ '(^|/)(obuna|c)/[^/:]';

UPDATE "Session"
SET "landingPath" = regexp_replace("landingPath", '(^|/)(obuna|c)/[^/:][^/]*', '\1\2/:token', 'g')
WHERE "landingPath" ~ '(^|/)(obuna|c)/[^/:]';

UPDATE "Session"
SET "exitPath" = regexp_replace("exitPath", '(^|/)(obuna|c)/[^/:][^/]*', '\1\2/:token', 'g')
WHERE "exitPath" ~ '(^|/)(obuna|c)/[^/:]';

UPDATE "Visitor"
SET "firstTouch" = jsonb_set("firstTouch", '{landing}',
  to_jsonb(regexp_replace("firstTouch"->>'landing', '(^|/)(obuna|c)/[^/:][^/]*', '\1\2/:token', 'g')))
WHERE "firstTouch"->>'landing' ~ '(^|/)(obuna|c)/[^/:]';

UPDATE "Visitor"
SET "lastTouch" = jsonb_set("lastTouch", '{landing}',
  to_jsonb(regexp_replace("lastTouch"->>'landing', '(^|/)(obuna|c)/[^/:][^/]*', '\1\2/:token', 'g')))
WHERE "lastTouch"->>'landing' ~ '(^|/)(obuna|c)/[^/:]';

UPDATE "Customer"
SET "firstTouch" = jsonb_set("firstTouch", '{landing}',
  to_jsonb(regexp_replace("firstTouch"->>'landing', '(^|/)(obuna|c)/[^/:][^/]*', '\1\2/:token', 'g')))
WHERE "firstTouch"->>'landing' ~ '(^|/)(obuna|c)/[^/:]';

UPDATE "Customer"
SET "lastTouch" = jsonb_set("lastTouch", '{landing}',
  to_jsonb(regexp_replace("lastTouch"->>'landing', '(^|/)(obuna|c)/[^/:][^/]*', '\1\2/:token', 'g')))
WHERE "lastTouch"->>'landing' ~ '(^|/)(obuna|c)/[^/:]';

-- Heatmap aggregates are keyed by path (a rewrite could collide): drop those rows; the hourly
-- job rebuilds today/yesterday from the scrubbed events.
DELETE FROM "HeatmapCell" WHERE "path" ~ '(^|/)(obuna|c)/[^/:]';
DELETE FROM "HeatmapElement" WHERE "path" ~ '(^|/)(obuna|c)/[^/:]';
DELETE FROM "HeatmapPage" WHERE "path" ~ '(^|/)(obuna|c)/[^/:]';
