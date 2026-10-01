-- Ticket 43: the sweep for Trip Fee Refunds stuck after a late settlement
-- rotates a Payment it failed to refund behind the ones it has not failed.
-- Additive, nullable, no backfill: null means "never failed", true of every
-- existing row. A sort key only; it never feeds a money decision.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "refundSweepFailedAt" TIMESTAMP(3);
