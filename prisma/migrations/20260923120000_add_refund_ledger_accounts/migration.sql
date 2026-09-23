-- AlterEnum
ALTER TYPE "RefundStatus" ADD VALUE 'AWAITING_DONOR_DETAILS';
ALTER TYPE "RefundStatus" ADD VALUE 'APPROVED';
ALTER TYPE "RefundStatus" ADD VALUE 'FAILED';

-- AlterEnum
ALTER TYPE "LedgerAccount" ADD VALUE 'FROZEN_BALANCE';
ALTER TYPE "LedgerAccount" ADD VALUE 'REFUND_COST';

-- AlterTable
-- Refund has never had a row written to it anywhere in this codebase (this
-- ticket's own Problem Statement: "Refund exists only as a schema model.
-- Nothing in this codebase creates, approves, or completes one") -- safe to
-- add NOT NULL with no backfill in any real environment.
ALTER TABLE "Refund" ADD COLUMN "requestedById" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
