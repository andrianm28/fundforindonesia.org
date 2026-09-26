-- Verification Request, first slice (verification-request 01). Additive:
-- three new tables, a new outcome enum, a SUBMITTED status-change action, and
-- the Campaign default moves from SUBMITTED to DRAFT, so a Campaign created
-- without an explicit status never reaches the Verifier queue on its own.
-- Every foreign key is RESTRICT: nothing here is ever deleted.

-- CreateEnum
CREATE TYPE "VerificationOutcome" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "CampaignStatusChangeAction" ADD VALUE 'SUBMITTED';

-- AlterTable
ALTER TABLE "Campaign" ALTER COLUMN "lifecycleStatus" SET DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checklist" JSONB NOT NULL,
    "outcome" "VerificationOutcome" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "isFirst" BOOLEAN NOT NULL,

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verifierId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "IdentityVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationChecklistItem" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "VerificationChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationRequest_outcome_submittedAt_idx" ON "VerificationRequest"("outcome", "submittedAt");

-- CreateIndex
CREATE INDEX "VerificationRequest_campaignId_submittedAt_idx" ON "VerificationRequest"("campaignId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityVerification_userId_key" ON "IdentityVerification"("userId");

-- CreateIndex
CREATE INDEX "VerificationChecklistItem_active_position_idx" ON "VerificationChecklistItem"("active", "position");

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityVerification" ADD CONSTRAINT "IdentityVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityVerification" ADD CONSTRAINT "IdentityVerification_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the checklist with PRD §7.1's "Semua" row, so every environment has
-- it. Stable ids, so a later migration can address them.
INSERT INTO "VerificationChecklistItem" ("id", "label", "required", "position", "active") VALUES
  ('identitas-fundraiser', 'KTP Fundraiser perorangan atau akta pendirian organisasi', true, 1, true),
  ('rencana-anggaran', 'Rencana anggaran', true, 2, true),
  ('bukti-masalah', 'Bukti masalah berupa foto, surat keterangan, atau tautan berita', true, 3, true);

-- Backfill: a Campaign already waiting in the Verifier queue gets its PENDING
-- Verification Request, since the queue now reads requests, not Campaigns.
-- Before this migration a Campaign could only become Submitted by being
-- created, so each is a first request, submitted by its creator on creation.
INSERT INTO "VerificationRequest" ("id", "campaignId", "submittedById", "submittedAt", "checklist", "outcome", "isFirst")
SELECT
  gen_random_uuid()::text,
  c."id",
  c."creatorId",
  c."createdAt",
  (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object('id', i."id", 'label', i."label", 'required', i."required", 'position', i."position", 'ticked', false)
        ORDER BY i."position"
      ),
      '[]'::jsonb
    )
    FROM "VerificationChecklistItem" i
    WHERE i."active"
  ),
  'PENDING',
  true
FROM "Campaign" c
WHERE c."lifecycleStatus" = 'SUBMITTED';
