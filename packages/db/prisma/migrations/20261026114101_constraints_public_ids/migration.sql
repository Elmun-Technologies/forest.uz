-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "label" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "publicId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Order_publicId_key" ON "Order"("publicId");


-- ───────── Invariants enforced in the DB (docs/04) ─────────
-- Search normalization also exists in app code; unaccent is kept for SQL-side search/reporting.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Invariant 5: stock and reservations never negative. (reserved may exceed stock briefly when
-- MoySklad lowers stock after an offline sale; availability is clamped at 0 in code.)
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_stock_nonneg" CHECK ("stock" >= 0);
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_reserved_nonneg" CHECK ("reserved" >= 0);
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_price_nonneg" CHECK ("priceTiyin" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_qty_pos" CHECK ("qty" > 0);
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_qty_pos" CHECK ("qty" > 0);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_qty_pos" CHECK ("qty" > 0);
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

-- Invariant 2: order totals consistent.
ALTER TABLE "Order" ADD CONSTRAINT "Order_total_consistent"
  CHECK ("totalTiyin" = "subtotalTiyin" - "discountTiyin" + "shippingTiyin" AND "totalTiyin" >= 0);

-- Invariant 3: at most one PAID payment per order. A trigger (not a partial index) so Prisma's
-- drift detection, which doesn't model partial indexes, leaves it alone.
CREATE OR REPLACE FUNCTION forest_one_paid_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'PAID' AND EXISTS (
    SELECT 1 FROM "Payment" p WHERE p."orderId" = NEW."orderId" AND p."status" = 'PAID' AND p."id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'order % already has a PAID payment', NEW."orderId" USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Payment_one_paid" BEFORE INSERT OR UPDATE OF "status" ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION forest_one_paid_payment();

-- Invariant 1: an ACTIVE product needs IKPU on every active variant (fiscal receipts).
CREATE OR REPLACE FUNCTION forest_product_ikpu_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM "Variant" v WHERE v."productId" = NEW."id" AND v."active" AND (v."ikpu" IS NULL OR v."ikpu" = '')
  ) THEN
    RAISE EXCEPTION 'product % cannot be ACTIVE: a variant has no IKPU', NEW."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Product_ikpu_guard" BEFORE INSERT OR UPDATE OF "status" ON "Product"
  FOR EACH ROW EXECUTE FUNCTION forest_product_ikpu_guard();

CREATE OR REPLACE FUNCTION forest_variant_ikpu_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."active" AND (NEW."ikpu" IS NULL OR NEW."ikpu" = '') AND EXISTS (
    SELECT 1 FROM "Product" p WHERE p."id" = NEW."productId" AND p."status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'variant % of an ACTIVE product must have IKPU', NEW."sku" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Variant_ikpu_guard" BEFORE INSERT OR UPDATE OF "ikpu", "active", "productId" ON "Variant"
  FOR EACH ROW EXECUTE FUNCTION forest_variant_ikpu_guard();

-- ───────── Event partitions: bounds pinned to UTC regardless of session TimeZone ─────────
CREATE OR REPLACE FUNCTION ensure_event_partitions(months_ahead integer DEFAULT 3)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  m timestamp := date_trunc('month', now() AT TIME ZONE 'UTC') - interval '1 month';
  last timestamp := date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => months_ahead);
  part text;
BEGIN
  WHILE m <= last LOOP
    part := format('event_%s', to_char(m, 'YYYY_MM'));
    IF to_regclass(format('event_parts.%I', part)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE event_parts.%I PARTITION OF public."Event" FOR VALUES FROM (%L) TO (%L)',
        part, (m AT TIME ZONE 'UTC'), ((m + interval '1 month') AT TIME ZONE 'UTC')
      );
    END IF;
    m := m + interval '1 month';
  END LOOP;
END $$;

-- Rows in the DEFAULT partition mean a monthly partition was missing (alerted by the API job).
CREATE OR REPLACE FUNCTION event_default_partition_rows() RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM event_parts.event_default
$$;
