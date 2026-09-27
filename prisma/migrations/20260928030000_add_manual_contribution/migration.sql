-- Manual Contribution (prd-compliance 34 / PRD FFI-07c; CONTEXT.md, Manual
-- Contribution): money that arrives outside the payment gateway, recorded by
-- one Admin with the proof of transfer and approved by a different one.
--
-- Additive: two new LedgerAccount values, one new table, two new columns on
-- LedgerEntry, three relation columns on User, and one on Campaign. Nothing is
-- backfilled and nothing existing changes behaviour -- a Manual Contribution
-- is the only writer of the new accounts, and there are none of them yet.
--
-- Two deliberate shapes:
--
--  - PROGRAM_BALANCE is a ledger account a Program can hold money in, scoped by
--    a BARE `programId` scalar on LedgerEntry with no foreign key and no
--    back-relation on Program. csr-01 drew a line that no money model reaches a
--    Program; a @relation would have put the word "ledger" on the Program row
--    and undone it (program-money-isolation.test.ts pins both halves). The
--    referential guarantee comes from ManualContribution.programId below, a
--    real foreign key, written in the same transaction as the entries.
--
--  - Every relation ON ManualContribution is onDelete: Restrict, like Payout
--    and CampaignStatusChange: a contribution record, who recorded it, who
--    approved it and how much it was are all evidence, and deleting a
--    Campaign, a Program or a person must not be able to take any of it away.
--    The one exception is the ledger's back-reference,
--    LedgerEntry.manualContributionId, which is onDelete: SetNull: a ledger
--    entry is the immutable record of the money and outlives the row it points
--    at, so the reference is cleared rather than the entry going with it.
--    Nothing in src deletes a ManualContribution -- a reversal is an opposite
--    journal, and the decision route enumerates its verbs so "delete" has
--    nowhere to land -- so this table is only defensible, not depended on.
--    That is asserted rather than assumed: manual-contributions.test.ts
--    scans all of src for a delete of this row.

-- CreateEnum
CREATE TYPE "ManualContributionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVERSED');

-- AlterEnum
ALTER TYPE "LedgerAccount" ADD VALUE 'PROGRAM_BALANCE';

-- AlterEnum
ALTER TYPE "LedgerAccount" ADD VALUE 'MANUAL_INTAKE_CLEARING';

-- CreateTable
CREATE TABLE "ManualContribution" (
    "id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "campaignId" TEXT,
    "programId" TEXT,
    "proofReference" VARCHAR(500) NOT NULL,
    "note" TEXT,
    "status" "ManualContributionStatus" NOT NULL DEFAULT 'PENDING',
    "recordedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualContribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualContribution_campaignId_status_idx" ON "ManualContribution"("campaignId", "status");

-- CreateIndex
CREATE INDEX "ManualContribution_programId_status_idx" ON "ManualContribution"("programId", "status");

-- CreateIndex
CREATE INDEX "ManualContribution_status_createdAt_idx" ON "ManualContribution"("status", "createdAt");

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "programId" TEXT,
ADD COLUMN     "manualContributionId" TEXT;

-- CreateIndex
CREATE INDEX "LedgerEntry_account_programId_idx" ON "LedgerEntry"("account", "programId");

-- CreateIndex
CREATE INDEX "LedgerEntry_manualContributionId_idx" ON "LedgerEntry"("manualContributionId");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_manualContributionId_fkey" FOREIGN KEY ("manualContributionId") REFERENCES "ManualContribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualContribution" ADD CONSTRAINT "ManualContribution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualContribution" ADD CONSTRAINT "ManualContribution_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualContribution" ADD CONSTRAINT "ManualContribution_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualContribution" ADD CONSTRAINT "ManualContribution_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualContribution" ADD CONSTRAINT "ManualContribution_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
