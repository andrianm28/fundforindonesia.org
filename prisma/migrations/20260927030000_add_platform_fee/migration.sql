-- Platform Fee configuration and freezing (prd-compliance 17; CONTEXT.md,
-- Platform Fee). Additive: one new column, one new enum, two new
-- append-only tables. No backfill -- an existing Payment's platformFee
-- defaults to 0 (money already settled before this ticket carried no
-- Platform Fee), and no PlatformFeeRule/PlatformFeeThreshold row exists
-- until an Admin sets one, so resolution falls through to no fee and no
-- waiver rather than this migration inventing a rate.

-- CreateEnum
CREATE TYPE "PlatformFeeScope" AS ENUM ('KIND', 'CATEGORY', 'CAMPAIGN');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "platformFee" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PlatformFeeRule" (
    "id" TEXT NOT NULL,
    "scope" "PlatformFeeScope" NOT NULL,
    "kind" "Kind",
    "category" TEXT,
    "campaignId" TEXT,
    "percentBps" INTEGER NOT NULL,
    "setById" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformFeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformFeeThreshold" (
    "id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "setById" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformFeeThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformFeeRule_scope_kind_setAt_idx" ON "PlatformFeeRule"("scope", "kind", "setAt");

-- CreateIndex
CREATE INDEX "PlatformFeeRule_scope_category_setAt_idx" ON "PlatformFeeRule"("scope", "category", "setAt");

-- CreateIndex
CREATE INDEX "PlatformFeeRule_scope_campaignId_setAt_idx" ON "PlatformFeeRule"("scope", "campaignId", "setAt");

-- CreateIndex
CREATE INDEX "PlatformFeeThreshold_setAt_idx" ON "PlatformFeeThreshold"("setAt");

-- AddForeignKey
ALTER TABLE "PlatformFeeRule" ADD CONSTRAINT "PlatformFeeRule_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformFeeRule" ADD CONSTRAINT "PlatformFeeRule_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformFeeThreshold" ADD CONSTRAINT "PlatformFeeThreshold_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
