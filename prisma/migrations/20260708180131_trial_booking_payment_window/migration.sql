-- AlterTable
ALTER TABLE "TrialBooking" ADD COLUMN     "note" TEXT,
ADD COLUMN     "paymentCapturedAt" TIMESTAMP(3),
ADD COLUMN     "refundPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TrialBooking_storeId_status_idx" ON "TrialBooking"("storeId", "status");
