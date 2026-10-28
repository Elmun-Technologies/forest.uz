-- Tracker ingest (docs/07): last touch of the visitor next to the first one.
ALTER TABLE "Visitor" ADD COLUMN "lastTouch" JSONB;
