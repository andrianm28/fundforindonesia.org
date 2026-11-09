-- PKS Pasal 4.5 (pks-pemenuhan/12): a Payout request carries supporting private
-- Documents and a note, and an Admin can send it back for revision.
--
-- 1. PayoutStatus.REVISION_REQUESTED: DRAFT -> REVISION_REQUESTED (Admin, with a
--    reason) -> DRAFT (the Fundraiser resubmits). approvePayout accepts DRAFT
--    only, so a Payout in revision cannot be approved, and neither step writes
--    a ledger row.
-- 2. Payout.supportingNote and the revision trail (reason, who, when).
-- 3. Document.payoutId: a supporting paper owned by a Payout. The "exactly one
--    owner" CHECK from the private document store now allows this third owner.

-- AlterEnum
ALTER TYPE "PayoutStatus" ADD VALUE 'REVISION_REQUESTED';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "payoutId" TEXT;

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "revisionReason" VARCHAR(500),
ADD COLUMN     "revisionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "revisionRequestedById" TEXT,
ADD COLUMN     "supportingNote" VARCHAR(1000);

-- CreateIndex
CREATE INDEX "Document_payoutId_uploadedAt_idx" ON "Document"("payoutId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_revisionRequestedById_fkey" FOREIGN KEY ("revisionRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exactly one owner: a Campaign document names its checklist item, an
-- organisation document or a Payout document names none.
ALTER TABLE "Document" DROP CONSTRAINT "Document_one_owner";
ALTER TABLE "Document" ADD CONSTRAINT "Document_one_owner" CHECK (
  ("campaignId" IS NOT NULL AND "partnerOrganisationId" IS NULL AND "payoutId" IS NULL AND "checklistItemId" IS NOT NULL)
  OR ("campaignId" IS NULL AND "partnerOrganisationId" IS NOT NULL AND "payoutId" IS NULL AND "checklistItemId" IS NULL)
  OR ("campaignId" IS NULL AND "partnerOrganisationId" IS NULL AND "payoutId" IS NOT NULL AND "checklistItemId" IS NULL)
);
