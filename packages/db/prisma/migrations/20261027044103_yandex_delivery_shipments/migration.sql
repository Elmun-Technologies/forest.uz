-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "acceptedAt" TIMESTAMPTZ(3),
ADD COLUMN     "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "nextSyncAt" TIMESTAMPTZ(3),
ADD COLUMN     "providerData" JSONB,
ADD COLUMN     "providerStatus" TEXT,
ADD COLUMN     "syncFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "syncedAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "Shipment_carrier_externalId_idx" ON "Shipment"("carrier", "externalId");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_carrier_nextSyncAt_idx" ON "Shipment"("carrier", "nextSyncAt");
