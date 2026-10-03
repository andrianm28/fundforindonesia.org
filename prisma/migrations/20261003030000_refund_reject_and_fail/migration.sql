-- Refund reject and fail (prd-compliance 49): the two statuses that return a
-- Refund's frozen money, REJECTED (before approval) and FAILED (after it).
-- Additive: six nullable columns recording who, when and why, no backfill.
-- The enum values already exist; the ledger side is a mirror journal posted by
-- the service layer, not something this migration touches.

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "failedById" TEXT,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" TEXT;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_failedById_fkey" FOREIGN KEY ("failedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
