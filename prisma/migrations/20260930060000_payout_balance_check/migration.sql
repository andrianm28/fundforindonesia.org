-- CreateTable
CREATE TABLE "PayoutBalanceCheck" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "checkedById" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "recordedBalance" INTEGER NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutBalanceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayoutBalanceCheck_payoutId_idx" ON "PayoutBalanceCheck"("payoutId");

-- AddForeignKey
ALTER TABLE "PayoutBalanceCheck" ADD CONSTRAINT "PayoutBalanceCheck_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBalanceCheck" ADD CONSTRAINT "PayoutBalanceCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
