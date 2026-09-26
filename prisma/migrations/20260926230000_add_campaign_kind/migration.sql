-- A Campaign declares its Kind (prd-compliance 09; ADR 0002, 0013), which
-- decides its money rules, starting with whether a deadline is mandatory.
-- Additive: the NOT NULL column's default backfills every existing Campaign
-- to DONATION, the only Kind the platform ran before this column existed.

-- CreateEnum
CREATE TYPE "Kind" AS ENUM ('DONATION', 'ZAKAT', 'WAKAF', 'HIBAH');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "kind" "Kind" NOT NULL DEFAULT 'DONATION';

-- CreateIndex
CREATE INDEX "Campaign_kind_idx" ON "Campaign"("kind");
