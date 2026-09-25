-- CreateEnum
CREATE TYPE "FlagResolution" AS ENUM ('SUSPENDED', 'DISMISSED');

-- CreateTable
CREATE TABLE "CampaignFlag" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "verifierId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" "FlagResolution",
    "resolvedById" TEXT,
    "resolutionReason" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignFlag_campaignId_resolution_idx" ON "CampaignFlag"("campaignId", "resolution");

-- AddForeignKey
ALTER TABLE "CampaignFlag" ADD CONSTRAINT "CampaignFlag_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignFlag" ADD CONSTRAINT "CampaignFlag_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignFlag" ADD CONSTRAINT "CampaignFlag_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

