-- Ticket 16 (ADR 0018): a BankAccount is created by its owner, and a
-- BankAccountVerificationRequest is what a Verifier decides -- a separate
-- table, not VerificationRequest with a nullable campaignId, because a
-- BankAccount belongs to a User, who has no Campaign, and
-- VerificationRequest.campaignId is required with ON DELETE RESTRICT.
--
-- No column on BankAccount changes and nothing is backfilled: the seed's
-- accounts carry a verifiedAt and no check record, which is honest, because
-- no real account exists yet and a fabricated verifier id and date would be a
-- lie (ticket 16). No read path needs the record.

-- CreateTable
CREATE TABLE "BankAccountVerificationRequest" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "outcome" "VerificationOutcome" NOT NULL DEFAULT 'PENDING',
    "checkedBankCode" TEXT,
    "documentedAccountName" TEXT,
    "note" TEXT,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "BankAccountVerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the Verifier queue, oldest PENDING first.
CREATE INDEX "BankAccountVerificationRequest_outcome_submittedAt_idx" ON "BankAccountVerificationRequest"("outcome", "submittedAt");

-- CreateIndex: one account's own history.
CREATE INDEX "BankAccountVerificationRequest_bankAccountId_submittedAt_idx" ON "BankAccountVerificationRequest"("bankAccountId", "submittedAt");

-- CreateIndex: at most one PENDING request per account (flow step 2). Partial,
-- so it lives here and not in schema.prisma, like "Payment_donationId_paid_key".
-- Two submissions racing past the service's check cannot both land PENDING.
CREATE UNIQUE INDEX "BankAccountVerificationRequest_bankAccountId_pending_key" ON "BankAccountVerificationRequest"("bankAccountId") WHERE "outcome" = 'PENDING';

-- AddForeignKey
ALTER TABLE "BankAccountVerificationRequest" ADD CONSTRAINT "BankAccountVerificationRequest_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccountVerificationRequest" ADD CONSTRAINT "BankAccountVerificationRequest_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccountVerificationRequest" ADD CONSTRAINT "BankAccountVerificationRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
