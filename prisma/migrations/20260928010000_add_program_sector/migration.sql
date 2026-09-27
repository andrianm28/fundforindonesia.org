-- Program and Sector: the CSR collaboration catalog (csr-01; CONTEXT.md,
-- Program and Sector). Additive: one new enum and one new table. The Sector
-- values are fixed here, in code -- no table or Admin panel may add, remove,
-- or rename one. Program carries no Kind and no relation any Donation,
-- Payment, Refund, Payout, or ledger code path can reach, so nothing here can
-- take money online; the off-books reported figure (reportedAmount and
-- friends) is a plain number with no ledger behind it, by design. Nothing is
-- backfilled: the catalog starts empty.

-- CreateEnum
CREATE TYPE "Sector" AS ENUM ('HEALTH', 'EDUCATION', 'ENVIRONMENT', 'DISABILITY_INCLUSION');

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sector" "Sector" NOT NULL,
    "problem" TEXT NOT NULL,
    "beneficiaries" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "activities" TEXT NOT NULL,
    "budget" INTEGER NOT NULL,
    "timeline" TEXT NOT NULL,
    "kpis" TEXT[],
    "documentation" TEXT[],
    "impactReport" TEXT,
    "reportedAmount" INTEGER NOT NULL DEFAULT 0,
    "reportedAsOf" TIMESTAMP(3),
    "reportedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Program_slug_key" ON "Program"("slug");

-- CreateIndex
CREATE INDEX "Program_sector_idx" ON "Program"("sector");
