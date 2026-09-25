-- CreateEnum
CREATE TYPE "CampaignStatusChangeAction" AS ENUM ('SUBMISSION_APPROVED', 'SUBMISSION_REJECTED', 'COMPLETED', 'SUSPENDED', 'SUSPENSION_LIFTED', 'CANCELLED', 'EXPIRED', 'URGENT_SET', 'URGENT_CLEARED');

-- CreateEnum
CREATE TYPE "StatusChangeCapacity" AS ENUM ('FUNDRAISER', 'VERIFIER', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "CampaignStatusChange" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "action" "CampaignStatusChangeAction" NOT NULL,
    "fromStatus" "CampaignStatus",
    "toStatus" "CampaignStatus",
    "actorId" TEXT,
    "capacity" "StatusChangeCapacity" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignStatusChange_campaignId_createdAt_idx" ON "CampaignStatusChange"("campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "CampaignStatusChange" ADD CONSTRAINT "CampaignStatusChange_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignStatusChange" ADD CONSTRAINT "CampaignStatusChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

