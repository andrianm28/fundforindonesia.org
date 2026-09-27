-- Abuse thresholds and the markers they raise (prd-compliance 38,
-- PRD §"Anti penyalahgunaan"; CONTEXT.md, Verifikasi Tambahan, Penanda
-- Audit, Penanda Donasi). Additive, except for one backfill:
--   - AbuseThreshold: the four limits an Admin sets, append-only, latest
--     row per kind in force. No row is seeded: with none set, the PRD's own
--     numbers apply, read from code (src/lib/abuse-thresholds.ts), the same
--     way an unset Platform Fee resolves to 0 bps rather than to a guess.
--   - CampaignAuditMarker: one row per Campaign once its Cumulative Gross
--     passes the audit threshold. The unique campaignId IS the "once".
--   - DonationReviewMarker: one row per Donation above the single-Donation
--     threshold. Nothing is blocked; the Donation settled either way.
--   - VerificationRequest.kind: which of the three kinds of request a row
--     is, so an AMOUNT_REVIEW (raised by the System, moves no status, and
--     cannot be withdrawn by the Fundraiser) is told apart from a CHANGE by
--     a column rather than inferred from a nullable JSON blob.
--     submittedById becomes nullable for the same reason: the System raises
--     an amount review and is not a person, so there is nobody to point at.

-- CreateEnum
-- Both enums are created before anything that uses them: the ALTER below
-- names "VerificationRequestKind", and a type that does not exist yet is a
-- 42704, not a deferred constraint.
CREATE TYPE "VerificationRequestKind" AS ENUM ('SUBMISSION', 'CHANGE', 'AMOUNT_REVIEW');

-- CreateEnum
CREATE TYPE "AbuseThresholdKind" AS ENUM ('CAMPAIGN_REVIEW_GROSS', 'CAMPAIGN_AUDIT_GROSS', 'DONATION_REVIEW_AMOUNT', 'ACTIVE_CAMPAIGNS_PER_FUNDRAISER');

-- AlterTable
ALTER TABLE "VerificationRequest" ADD COLUMN     "kind" "VerificationRequestKind" NOT NULL DEFAULT 'SUBMISSION',
ADD COLUMN     "raisedByAmount" JSONB,
ALTER COLUMN "submittedById" DROP NOT NULL;

-- Backfill from the column the two existing kinds are already told apart by:
-- a request carrying a proposal is a CHANGE, everything else was submitted
-- from Draft or Rejected. Deterministic, so no row is left to the default.
UPDATE "VerificationRequest" SET "kind" = 'CHANGE' WHERE "proposedChanges" IS NOT NULL;

-- CreateTable
CREATE TABLE "AbuseThreshold" (
    "id" TEXT NOT NULL,
    "kind" "AbuseThresholdKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "setById" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbuseThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignAuditMarker" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "cumulativeGross" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignAuditMarker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonationReviewMarker" (
    "id" TEXT NOT NULL,
    "donationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "flaggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DonationReviewMarker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The kind+setAt index is the one read: "the latest row for this kind".
CREATE INDEX "AbuseThreshold_kind_setAt_idx" ON "AbuseThreshold"("kind", "setAt");

-- CreateIndex
-- The uniques are the idempotence, not a lookup aid: a retried settlement,
-- or a second Donation above the threshold on a Campaign that already has
-- its audit marker, must not write a second row for the same subject.
CREATE UNIQUE INDEX "CampaignAuditMarker_campaignId_key" ON "CampaignAuditMarker"("campaignId");
CREATE UNIQUE INDEX "DonationReviewMarker_donationId_key" ON "DonationReviewMarker"("donationId");

-- CreateIndex
-- The Admin's scrutiny view lists a Campaign's flagged Donations newest
-- first, so the index is (campaignId, flaggedAt) rather than the id alone.
CREATE INDEX "DonationReviewMarker_campaignId_flaggedAt_idx" ON "DonationReviewMarker"("campaignId", "flaggedAt");

-- AddForeignKey
ALTER TABLE "AbuseThreshold" ADD CONSTRAINT "AbuseThreshold_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAuditMarker" ADD CONSTRAINT "CampaignAuditMarker_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationReviewMarker" ADD CONSTRAINT "DonationReviewMarker_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationReviewMarker" ADD CONSTRAINT "DonationReviewMarker_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
