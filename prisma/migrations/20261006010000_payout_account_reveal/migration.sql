-- Payout account reveal audit (ticket 89): one append-only row per opening of
-- a Payout's destination account number. Additive, no backfill.

-- CreateTable
CREATE TABLE "PayoutAccountReveal" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "revealedById" TEXT NOT NULL,
    "revealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutAccountReveal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayoutAccountReveal_payoutId_revealedAt_idx" ON "PayoutAccountReveal"("payoutId", "revealedAt");

-- AddForeignKey
ALTER TABLE "PayoutAccountReveal" ADD CONSTRAINT "PayoutAccountReveal_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAccountReveal" ADD CONSTRAINT "PayoutAccountReveal_revealedById_fkey" FOREIGN KEY ("revealedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
