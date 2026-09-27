-- PartnershipInquiry: a company's discussion request about one Program
-- (csr-05; CONTEXT.md, Partnership Inquiry). Additive: one new enum and one new
-- table, plus the foreign key back to Program. The Inquiry points at a Program
-- and carries contact details and a needs description; it is not a Program and
-- moves no money, so nothing here reaches Donation, Payment, Refund, Payout, or
-- the ledger. The follow-up status starts at NOT_YET_FOLLOWED_UP, the value
-- csr-06 moves forward. Nothing is backfilled: no company has asked yet.

-- CreateEnum
CREATE TYPE "PartnershipInquiryStatus" AS ENUM ('NOT_YET_FOLLOWED_UP', 'IN_PROGRESS', 'DONE');

-- CreateTable
CREATE TABLE "PartnershipInquiry" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "needs" TEXT NOT NULL,
    "status" "PartnershipInquiryStatus" NOT NULL DEFAULT 'NOT_YET_FOLLOWED_UP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnershipInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnershipInquiry_programId_idx" ON "PartnershipInquiry"("programId");

-- CreateIndex
CREATE INDEX "PartnershipInquiry_status_idx" ON "PartnershipInquiry"("status");

-- AddForeignKey
ALTER TABLE "PartnershipInquiry" ADD CONSTRAINT "PartnershipInquiry_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
