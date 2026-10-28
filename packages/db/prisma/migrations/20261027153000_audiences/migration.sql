-- Audiences (A8) + server-side ad signals (CLAUDE.md §6 "Audiences", "Ad signals").

-- Segment: preset key, description, refresh bookkeeping.
ALTER TABLE "Segment"
  ADD COLUMN "key" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "refreshError" TEXT,
  ADD COLUMN "lastAdded" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastRemoved" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "Segment_key_key" ON "Segment"("key");

-- SegmentMember: leavers are kept (removedAt) for the 30-day result.
ALTER TABLE "SegmentMember" ADD COLUMN "removedAt" TIMESTAMPTZ(3);
CREATE INDEX "SegmentMember_segmentId_removedAt_idx" ON "SegmentMember"("segmentId", "removedAt");

CREATE TABLE "SegmentDestination" (
    "segmentId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "members" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SegmentDestination_pkey" PRIMARY KEY ("segmentId", "destination")
);
ALTER TABLE "SegmentDestination" ADD CONSTRAINT "SegmentDestination_segmentId_fkey"
  FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SegmentDestinationMember" (
    "segmentId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "syncedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SegmentDestinationMember_pkey" PRIMARY KEY ("segmentId", "destination", "customerId")
);
ALTER TABLE "SegmentDestinationMember" ADD CONSTRAINT "SegmentDestinationMember_segmentId_fkey"
  FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AdSignal" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventTs" TIMESTAMPTZ(3) NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdSignal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdSignal_platform_eventId_key" ON "AdSignal"("platform", "eventId");
CREATE INDEX "AdSignal_status_nextAttemptAt_idx" ON "AdSignal"("status", "nextAttemptAt");
CREATE INDEX "AdSignal_platform_createdAt_idx" ON "AdSignal"("platform", "createdAt");

CREATE TABLE "JobCursor" (
    "key" TEXT NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobCursor_pkey" PRIMARY KEY ("key")
);

-- Preset segments (docs/07). Identical to packages/db/src/seed/data/audiences.ts (unit test);
-- product presets are skipped while the product does not exist (fresh DB: the seed adds them).
INSERT INTO "Segment" ("id", "key", "name", "description", "rules", "destinations", "active", "createdAt", "updatedAt")
SELECT 'seg_abandoned_cart_7d', 'abandoned_cart_7d', 'Savatni tashlaganlar · 7 kun', 'Savatga qo''shgan, lekin xarid qilmagan', '{"groups":[{"conditions":[{"type":"event","event":"add_to_cart","did":true,"withinDays":7},{"type":"event","event":"purchase","did":false,"withinDays":7}]}]}'::jsonb, ARRAY[]::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
ON CONFLICT DO NOTHING;

INSERT INTO "Segment" ("id", "key", "name", "description", "rules", "destinations", "active", "createdAt", "updatedAt")
SELECT 'seg_sofa_kit_viewers', 'sofa_kit_viewers', 'Divanni ko''rib ketganlar', 'Divan to''plami sahifasida 30 soniyadan ko''p bo''lgan, xarid qilmagan', replace('{"groups":[{"conditions":[{"type":"page_time","path":{"op":"equals","value":"/p/divan-yangilash-toplami"},"minSeconds":30,"withinDays":30,"did":true},{"type":"product","productId":"slug:divan-yangilash-toplami","bought":false}]}]}', '"slug:divan-yangilash-toplami"', to_jsonb(p0.id)::text)::jsonb, ARRAY[]::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Product" p0 WHERE p0.slug = 'divan-yangilash-toplami'
ON CONFLICT DO NOTHING;

INSERT INTO "Segment" ("id", "key", "name", "description", "rules", "destinations", "active", "createdAt", "updatedAt")
SELECT 'seg_leads_no_purchase', 'leads_no_purchase', 'Lead, xarid yo''q', 'Raqam qoldirgan (popup, tanlovchi, bot), xarid qilmagan', '{"groups":[{"conditions":[{"type":"lead","has":true},{"type":"orders","metric":"count","op":"lte","value":0}]}]}'::jsonb, ARRAY[]::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
ON CONFLICT DO NOTHING;

INSERT INTO "Segment" ("id", "key", "name", "description", "rules", "destinations", "active", "createdAt", "updatedAt")
SELECT 'seg_fabric_spray_upsell', 'fabric_spray_upsell', 'Mato spreyi oldi → tozalovchi upsell', 'Mato spreyi olgan, 21+ kun o''tgan, tozalovchi olmagan', replace(replace('{"groups":[{"conditions":[{"type":"product","productId":"slug:mato-boyogi-spreyi","bought":true,"olderThanDays":21},{"type":"product","productId":"slug:mato-tozalovchi","bought":false}]}]}', '"slug:mato-boyogi-spreyi"', to_jsonb(p0.id)::text), '"slug:mato-tozalovchi"', to_jsonb(p1.id)::text)::jsonb, ARRAY[]::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Product" p0, "Product" p1 WHERE p0.slug = 'mato-boyogi-spreyi' AND p1.slug = 'mato-tozalovchi'
ON CONFLICT DO NOTHING;

INSERT INTO "Segment" ("id", "key", "name", "description", "rules", "destinations", "active", "createdAt", "updatedAt")
SELECT 'seg_vip', 'vip', 'VIP mijozlar', 'Xaridlari jami 2 mln so''mdan yuqori', '{"groups":[{"conditions":[{"type":"orders","metric":"sum","op":"gte","value":2000000}]}]}'::jsonb, ARRAY[]::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
ON CONFLICT DO NOTHING;

INSERT INTO "Segment" ("id", "key", "name", "description", "rules", "destinations", "active", "createdAt", "updatedAt")
SELECT 'seg_inactive_60d', 'inactive_60d', 'Faol emas · 60+ kun', 'Oxirgi xariddan 60 kun o''tgan', '{"groups":[{"conditions":[{"type":"last_order","op":"older","days":60}]}]}'::jsonb, ARRAY[]::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
ON CONFLICT DO NOTHING;
