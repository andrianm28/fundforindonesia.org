-- Private document store (ticket 64, D-1; decision 03, owner C4/C5 2026-10-04).
--
-- 1. VerificationChecklistItem.requiresDocument: whether a checklist item is a
--    paper that must be uploaded before a Verifier may tick it. Seeded true for
--    the §7.1 items that are documents; false for the ones that are a check on
--    a record (the Kind Authorisation items, "bukan duplikat"). Admins change it
--    from the checklist editor afterwards.
-- 2. Document: one uploaded file, owned by a Campaign (with the checklist item
--    it evidences) or by a Partner Organisation. The bytes live on a private
--    host volume, never in the database and never under public/.
-- AlterTable
ALTER TABLE "VerificationChecklistItem" ADD COLUMN     "requiresDocument" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "campaignId" TEXT,
    "partnerOrganisationId" TEXT,
    "checklistItemId" TEXT,
    "label" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_storagePath_key" ON "Document"("storagePath");

-- CreateIndex
CREATE INDEX "Document_campaignId_checklistItemId_idx" ON "Document"("campaignId", "checklistItemId");

-- CreateIndex
CREATE INDEX "Document_partnerOrganisationId_uploadedAt_idx" ON "Document"("partnerOrganisationId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES "PartnerOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "VerificationChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Exactly one owner: a Campaign document names its checklist item, an
-- organisation document names none.
ALTER TABLE "Document" ADD CONSTRAINT "Document_one_owner" CHECK (
  ("campaignId" IS NOT NULL AND "partnerOrganisationId" IS NULL AND "checklistItemId" IS NOT NULL)
  OR ("campaignId" IS NULL AND "partnerOrganisationId" IS NOT NULL AND "checklistItemId" IS NULL)
);

-- A relative path only: no leading slash, no dot segments.
ALTER TABLE "Document" ADD CONSTRAINT "Document_storagePath_relative" CHECK (
  "storagePath" !~ '^/' AND "storagePath" !~ '(^|/)\.\.?(/|$)'
);

UPDATE "VerificationChecklistItem"
SET "requiresDocument" = true
WHERE "id" IN (
  'identitas-fundraiser',
  'rencana-anggaran',
  'bukti-masalah',
  'wakaf-lembaga-nazhir',
  'wakaf-draf-akad',
  'zakat-lembaga-amil',
  'hibah-lembaga-nazhir',
  'hibah-draf-akad'
);
