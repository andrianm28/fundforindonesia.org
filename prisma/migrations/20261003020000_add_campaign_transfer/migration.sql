-- Campaign Transfer (prd-compliance 33; PRD §7.2; ADR 0015): zakat or wakaf
-- money moved from a Suspended Campaign to another of the same Kind, recorded
-- by one Admin and decided by a different one.
--
-- Additive: one enum, one table, one nullable column on LedgerEntry. Nothing
-- is backfilled and nothing existing changes behaviour. Every relation on
-- CampaignTransfer is RESTRICT, like Manual Contribution: where a Suspended
-- Campaign's money went is evidence that deleting a Campaign or a person must
-- not remove. LedgerEntry.campaignTransferId is SET NULL: the entry is the
-- immutable record of the money and outlives the row it points at.

-- CreateEnum
CREATE TYPE "CampaignTransferStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "CampaignTransfer" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CampaignTransferStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignTransfer_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN "campaignTransferId" TEXT;

-- CreateIndex
CREATE INDEX "CampaignTransfer_sourceId_status_idx" ON "CampaignTransfer"("sourceId", "status");

-- CreateIndex
CREATE INDEX "CampaignTransfer_targetId_status_idx" ON "CampaignTransfer"("targetId", "status");

-- CreateIndex
CREATE INDEX "CampaignTransfer_status_createdAt_idx" ON "CampaignTransfer"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_campaignTransferId_idx" ON "LedgerEntry"("campaignTransferId");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_campaignTransferId_fkey" FOREIGN KEY ("campaignTransferId") REFERENCES "CampaignTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTransfer" ADD CONSTRAINT "CampaignTransfer_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTransfer" ADD CONSTRAINT "CampaignTransfer_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTransfer" ADD CONSTRAINT "CampaignTransfer_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTransfer" ADD CONSTRAINT "CampaignTransfer_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
