-- Ticket 15: the escrow release sweep can starve behind Payments a
-- permanent guard defers. Additive: one nullable column and an index for
-- the sweep's new paging order. No backfill -- a null
-- escrowSweepDeferredAt means "never skipped by a permanent guard", which
-- is true of every existing row and stays true for a row that has always
-- released cleanly.
--
-- Deliberately NOT escrowReleaseAt or escrowReleasedAt: those two are the
-- accounting record (a hold's maturity date, and when it was actually
-- released) and this column must never influence either. It exists only as
-- a secondary sort key releaseMaturedEscrow (src/lib/money/escrow.ts) uses
-- to rotate a permanently-stuck row to the back of the queue, so a backlog
-- of such rows can no longer fill every future call's page and starve the
-- genuinely releasable rows behind it.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "escrowSweepDeferredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Payment_escrowSweepDeferredAt_escrowReleaseAt_id_idx" ON "Payment"("escrowSweepDeferredAt", "escrowReleaseAt", "id");
