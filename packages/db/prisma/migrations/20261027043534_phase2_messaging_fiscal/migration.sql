-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "phone" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deliveredAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "FiscalReceipt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'SALE',
    "provider" TEXT NOT NULL,
    "receiptNumber" TEXT,
    "url" TEXT,
    "staffId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FiscalReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalReceipt_orderId_kind_key" ON "FiscalReceipt"("orderId", "kind");

-- CreateIndex
CREATE INDEX "Message_channel_providerId_idx" ON "Message"("channel", "providerId");

-- AddForeignKey
ALTER TABLE "FiscalReceipt" ADD CONSTRAINT "FiscalReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
