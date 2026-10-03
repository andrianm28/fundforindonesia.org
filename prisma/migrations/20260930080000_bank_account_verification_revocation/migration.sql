-- Ticket 11 (owner decision 2026-09-28, on top of ADR 0018): a Verifier who
-- is not the one who verified the account (and never the account's owner)
-- may revoke a Bank Account's verification, clearing `verifiedAt`; a
-- different Verifier than the revoker may reinstate it, with a reason, the
-- same pattern as Flag/Suspension. A separate action from Suspension:
-- neither table touches the other, and Payouts already paid are untouched --
-- `payouts.ts` already re-reads `verifiedAt` fresh in requestPayout,
-- approvePayout and completePayout, so an unpaid Payout is refused through
-- the existing BankAccountNotEligibleError path with no change to that file.
--
-- No column on BankAccount changes: `verifiedAt` stays the single field the
-- money path reads. This table is the append-only "why" and "who" of every
-- clear and restore of it, the same shape CampaignStatusChange is for a
-- Campaign's Suspension and its lift.

-- CreateEnum
CREATE TYPE "BankAccountRevocationAction" AS ENUM ('REVOKED', 'REINSTATED');

-- CreateTable
CREATE TABLE "BankAccountRevocation" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "action" "BankAccountRevocationAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAccountRevocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one account's own revoke/reinstate history, latest first.
CREATE INDEX "BankAccountRevocation_bankAccountId_createdAt_idx" ON "BankAccountRevocation"("bankAccountId", "createdAt");

-- AddForeignKey
ALTER TABLE "BankAccountRevocation" ADD CONSTRAINT "BankAccountRevocation_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccountRevocation" ADD CONSTRAINT "BankAccountRevocation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
