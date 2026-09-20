-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REJECTED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'COMPLETED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "lifecycleStatus" "CampaignStatus" NOT NULL DEFAULT 'SUBMITTED';

-- Backfill the new column from the legacy string values
UPDATE "Campaign" SET "lifecycleStatus" = 'SUBMITTED' WHERE "status" = 'pending';
UPDATE "Campaign" SET "lifecycleStatus" = 'ACTIVE' WHERE "status" = 'active';
UPDATE "Campaign" SET "lifecycleStatus" = 'REJECTED' WHERE "status" = 'rejected';
UPDATE "Campaign" SET "lifecycleStatus" = 'SUSPENDED' WHERE "status" = 'suspended';
UPDATE "Campaign" SET "lifecycleStatus" = 'COMPLETED' WHERE "status" = 'completed';
UPDATE "Campaign" SET "lifecycleStatus" = 'EXPIRED' WHERE "status" = 'expired';

-- CreateIndex
CREATE INDEX "Campaign_lifecycleStatus_idx" ON "Campaign"("lifecycleStatus");
