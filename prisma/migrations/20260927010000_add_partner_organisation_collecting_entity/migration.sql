-- Partner Organisation, Fundraising Permit and the Collecting Entity of a
-- Campaign (prd-compliance 10; ADR 0010). Additive: three new tables, one
-- audit enum, one status-change action and two nullable columns. Existing
-- Campaigns keep a NULL Collecting Entity and refuse Donations until an
-- Admin or Verifier assigns one; nothing is backfilled. Foreign keys
-- RESTRICT: none of these rows is ever deleted.

-- CreateEnum
CREATE TYPE "PartnerOrganisationAuditAction" AS ENUM ('REGISTERED', 'UPDATED', 'PERMIT_RECORDED', 'PERMIT_UPDATED');

-- AlterEnum
ALTER TYPE "CampaignStatusChangeAction" ADD VALUE 'COLLECTING_ENTITY_ASSIGNED';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "collectingEntityId" TEXT;

-- AlterTable
ALTER TABLE "VerificationRequest" ADD COLUMN     "collectingEntityId" TEXT;

-- CreateTable
CREATE TABLE "PartnerOrganisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fundraiserId" TEXT NOT NULL,
    "acceptsIndividualCampaigns" BOOLEAN NOT NULL DEFAULT false,
    "registeredById" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerOrganisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundraisingPermit" (
    "id" TEXT NOT NULL,
    "partnerOrganisationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "kinds" "Kind"[],
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundraisingPermit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerOrganisationAuditEntry" (
    "id" TEXT NOT NULL,
    "partnerOrganisationId" TEXT NOT NULL,
    "permitId" TEXT,
    "action" "PartnerOrganisationAuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "actedById" TEXT NOT NULL,
    "actedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerOrganisationAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerOrganisation_fundraiserId_key" ON "PartnerOrganisation"("fundraiserId");

-- CreateIndex
CREATE INDEX "FundraisingPermit_partnerOrganisationId_validTo_idx" ON "FundraisingPermit"("partnerOrganisationId", "validTo");

-- CreateIndex
CREATE INDEX "PartnerOrganisationAuditEntry_partnerOrganisationId_actedAt_idx" ON "PartnerOrganisationAuditEntry"("partnerOrganisationId", "actedAt");

-- CreateIndex
CREATE INDEX "Campaign_collectingEntityId_idx" ON "Campaign"("collectingEntityId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_collectingEntityId_fkey" FOREIGN KEY ("collectingEntityId") REFERENCES "PartnerOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_collectingEntityId_fkey" FOREIGN KEY ("collectingEntityId") REFERENCES "PartnerOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerOrganisation" ADD CONSTRAINT "PartnerOrganisation_fundraiserId_fkey" FOREIGN KEY ("fundraiserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerOrganisation" ADD CONSTRAINT "PartnerOrganisation_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundraisingPermit" ADD CONSTRAINT "FundraisingPermit_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES "PartnerOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundraisingPermit" ADD CONSTRAINT "FundraisingPermit_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerOrganisationAuditEntry" ADD CONSTRAINT "PartnerOrganisationAuditEntry_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES "PartnerOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerOrganisationAuditEntry" ADD CONSTRAINT "PartnerOrganisationAuditEntry_permitId_fkey" FOREIGN KEY ("permitId") REFERENCES "FundraisingPermit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerOrganisationAuditEntry" ADD CONSTRAINT "PartnerOrganisationAuditEntry_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

