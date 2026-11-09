-- PKS Pasal 3.6 (pks-pemenuhan/17): the full CSR collaboration module.
--
-- 1. PartnershipInquiryStatus goes from 3 to 8 stages. Postgres cannot drop or
--    remap enum values in place, so the type is recreated and the three
--    columns that use it are converted with an explicit mapping:
--      NOT_YET_FOLLOWED_UP -> NEW (Baru), IN_PROGRESS -> CONTACTED (Dihubungi),
--      DONE -> DONE (Selesai). Existing rows and history rows keep their meaning.
-- 2. New Inquiry fields: budget range, period, encrypted address and NPWP, PIC.
-- 3. History gains a note and the PIC change it records.
-- 4. Document.partnershipInquiryId: the proposal PDF, a fourth owner for the
--    "exactly one owner" CHECK, and uploadedById becomes optional because the
--    public form has no account.

-- CreateEnum
CREATE TYPE "PartnershipBudgetRange" AS ENUM ('UNDER_50M', 'FROM_50M_TO_250M', 'FROM_250M_TO_1B', 'OVER_1B');

-- Recreate the status enum with the eight stages and map the old rows.
ALTER TYPE "PartnershipInquiryStatus" RENAME TO "PartnershipInquiryStatus_old";
CREATE TYPE "PartnershipInquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'PROPOSAL', 'NEGOTIATION', 'APPROVED', 'ONGOING', 'DONE', 'DROPPED');

ALTER TABLE "PartnershipInquiry" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PartnershipInquiry" ALTER COLUMN "status" TYPE "PartnershipInquiryStatus" USING (
  CASE "status"::text
    WHEN 'NOT_YET_FOLLOWED_UP' THEN 'NEW'
    WHEN 'IN_PROGRESS' THEN 'CONTACTED'
    WHEN 'DONE' THEN 'DONE'
  END::"PartnershipInquiryStatus"
);
ALTER TABLE "PartnershipInquiry" ALTER COLUMN "status" SET DEFAULT 'NEW';

ALTER TABLE "PartnershipInquiryStatusChange" ALTER COLUMN "fromStatus" TYPE "PartnershipInquiryStatus" USING (
  CASE "fromStatus"::text
    WHEN 'NOT_YET_FOLLOWED_UP' THEN 'NEW'
    WHEN 'IN_PROGRESS' THEN 'CONTACTED'
    WHEN 'DONE' THEN 'DONE'
  END::"PartnershipInquiryStatus"
);
ALTER TABLE "PartnershipInquiryStatusChange" ALTER COLUMN "toStatus" TYPE "PartnershipInquiryStatus" USING (
  CASE "toStatus"::text
    WHEN 'NOT_YET_FOLLOWED_UP' THEN 'NEW'
    WHEN 'IN_PROGRESS' THEN 'CONTACTED'
    WHEN 'DONE' THEN 'DONE'
  END::"PartnershipInquiryStatus"
);
DROP TYPE "PartnershipInquiryStatus_old";

-- AlterTable
ALTER TABLE "PartnershipInquiry" ADD COLUMN     "budgetRange" "PartnershipBudgetRange",
ADD COLUMN     "companyAddressCiphertext" TEXT,
ADD COLUMN     "companyAddressKeyId" TEXT,
ADD COLUMN     "companyNpwpCiphertext" TEXT,
ADD COLUMN     "companyNpwpKeyId" TEXT,
ADD COLUMN     "periodEnd" VARCHAR(7),
ADD COLUMN     "periodStart" VARCHAR(7),
ADD COLUMN     "picId" TEXT;

-- AlterTable
ALTER TABLE "PartnershipInquiryStatusChange" ADD COLUMN     "note" VARCHAR(1000),
ADD COLUMN     "picChanged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "picFromId" TEXT,
ADD COLUMN     "picToId" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "partnershipInquiryId" TEXT,
ALTER COLUMN "uploadedById" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "PartnershipInquiry_picId_idx" ON "PartnershipInquiry"("picId");

-- CreateIndex
CREATE INDEX "Document_partnershipInquiryId_uploadedAt_idx" ON "Document"("partnershipInquiryId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "PartnershipInquiry" ADD CONSTRAINT "PartnershipInquiry_picId_fkey" FOREIGN KEY ("picId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnershipInquiryStatusChange" ADD CONSTRAINT "PartnershipInquiryStatusChange_picFromId_fkey" FOREIGN KEY ("picFromId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnershipInquiryStatusChange" ADD CONSTRAINT "PartnershipInquiryStatusChange_picToId_fkey" FOREIGN KEY ("picToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_partnershipInquiryId_fkey" FOREIGN KEY ("partnershipInquiryId") REFERENCES "PartnershipInquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one owner: a Campaign document names its checklist item; an
-- organisation, Payout or Partnership Inquiry document names none.
ALTER TABLE "Document" DROP CONSTRAINT "Document_one_owner";
ALTER TABLE "Document" ADD CONSTRAINT "Document_one_owner" CHECK (
  ("campaignId" IS NOT NULL AND "partnerOrganisationId" IS NULL AND "payoutId" IS NULL AND "partnershipInquiryId" IS NULL AND "checklistItemId" IS NOT NULL)
  OR ("campaignId" IS NULL AND "partnerOrganisationId" IS NOT NULL AND "payoutId" IS NULL AND "partnershipInquiryId" IS NULL AND "checklistItemId" IS NULL)
  OR ("campaignId" IS NULL AND "partnerOrganisationId" IS NULL AND "payoutId" IS NOT NULL AND "partnershipInquiryId" IS NULL AND "checklistItemId" IS NULL)
  OR ("campaignId" IS NULL AND "partnerOrganisationId" IS NULL AND "payoutId" IS NULL AND "partnershipInquiryId" IS NOT NULL AND "checklistItemId" IS NULL)
);
