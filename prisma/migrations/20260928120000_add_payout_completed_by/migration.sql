-- Payout completion (prd-compliance 27; CONTEXT.md, Payout; ADR 0006).
-- Additive: one nullable column and its foreign key. No backfill -- a
-- completedById of null means "nobody has recorded this Payout as
-- transferred", which is true of every existing row, and backfilling one
-- would invent a second person out of the approver -- exactly the two-person
-- rule this column exists to evidence.
--
-- No new LedgerAccount value: completion debits PAYOUT_CLEARING and
-- credits GATEWAY_CLEARING, the Provider Balance account already debited on
-- every settlement.

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "completedById" TEXT;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
