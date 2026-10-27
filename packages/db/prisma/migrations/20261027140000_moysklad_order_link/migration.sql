-- CreateTable
CREATE TABLE "MoyskladOrderLink" (
    "orderId" TEXT NOT NULL,
    "externalId" TEXT,
    "counterpartyId" TEXT,
    "pushedStatus" TEXT,
    "holdHandedOver" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MoyskladOrderLink_pkey" PRIMARY KEY ("orderId")
);

-- CreateIndex
CREATE UNIQUE INDEX "MoyskladOrderLink_externalId_key" ON "MoyskladOrderLink"("externalId");

-- CreateIndex
CREATE INDEX "MoyskladOrderLink_nextAttemptAt_idx" ON "MoyskladOrderLink"("nextAttemptAt");

-- AddForeignKey
ALTER TABLE "MoyskladOrderLink" ADD CONSTRAINT "MoyskladOrderLink_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
