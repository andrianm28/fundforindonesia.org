-- CreateTable
CREATE TABLE "UsageReport" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "lineItems" JSONB NOT NULL,
    "beneficiaryCount" INTEGER NOT NULL,
    "photos" TEXT[],
    "submittedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disputedAt" TIMESTAMP(3),
    "disputedReason" TEXT,
    "disputedById" TEXT,

    CONSTRAINT "UsageReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageReport_payoutId_key" ON "UsageReport"("payoutId");

-- AddForeignKey
ALTER TABLE "UsageReport" ADD CONSTRAINT "UsageReport_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageReport" ADD CONSTRAINT "UsageReport_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageReport" ADD CONSTRAINT "UsageReport_disputedById_fkey" FOREIGN KEY ("disputedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
