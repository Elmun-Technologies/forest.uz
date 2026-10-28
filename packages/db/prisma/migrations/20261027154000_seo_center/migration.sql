-- SEO center (A9): override timestamps, redirect hit time, search-engine query stats, PageSpeed lab runs.
ALTER TABLE "SeoMeta" ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Redirect" ADD COLUMN "lastHitAt" TIMESTAMPTZ(3);

CREATE TABLE "SearchQueryDaily" (
    "source" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "query" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" DOUBLE PRECISION,
    "syncedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchQueryDaily_pkey" PRIMARY KEY ("source","date","query")
);
CREATE INDEX "SearchQueryDaily_source_date_idx" ON "SearchQueryDaily"("source", "date");

CREATE TABLE "PageSpeedRun" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "score" INTEGER,
    "lcpMs" INTEGER,
    "cls" DOUBLE PRECISION,
    "tbtMs" INTEGER,
    "fcpMs" INTEGER,
    "staffId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageSpeedRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PageSpeedRun_url_createdAt_idx" ON "PageSpeedRun"("url", "createdAt");

-- SEO settings (deploys run only `migrate deploy`, so new keys are inserted here; the seed has the
-- same defaults). The IndexNow key is generated per install, never a literal (CLAUDE.md §6).
INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES
  ('seo.robots', '{"custom": null}'::jsonb, CURRENT_TIMESTAMP),
  ('seo.schema', '{"product": true, "organization": true, "breadcrumb": true, "faq": true, "howTo": false, "video": false}'::jsonb, CURRENT_TIMESTAMP),
  ('seo.indexnow', jsonb_build_object('enabled', true, 'key', replace(gen_random_uuid()::text, '-', '')), CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
