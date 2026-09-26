-- Kind Authorisation: a Verifier-granted, dated clearance for a Partner
-- Organisation to run Campaigns of one non-donation Kind (prd-compliance 11;
-- CONTEXT.md, Kind Authorisation; ADR 0013), on top of the Fundraising
-- Permit (prd-compliance 10). Additive: one new table, two new audit enum
-- values, and one nullable column on the existing audit table. Nothing is
-- backfilled: an existing zakat/wakaf/hibah Campaign refuses Donations until
-- a Verifier grants its Collecting Entity a Kind Authorisation, exactly like
-- a missing Fundraising Permit already does.

-- AlterEnum
ALTER TYPE "PartnerOrganisationAuditAction" ADD VALUE 'KIND_AUTHORISATION_GRANTED';
ALTER TYPE "PartnerOrganisationAuditAction" ADD VALUE 'KIND_AUTHORISATION_UPDATED';

-- AlterTable
ALTER TABLE "PartnerOrganisationAuditEntry" ADD COLUMN     "kindAuthorisationId" TEXT;

-- CreateTable
CREATE TABLE "KindAuthorisation" (
    "id" TEXT NOT NULL,
    "partnerOrganisationId" TEXT NOT NULL,
    "kind" "Kind" NOT NULL,
    "documentReference" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "grantedById" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KindAuthorisation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KindAuthorisation_partnerOrganisationId_validTo_idx" ON "KindAuthorisation"("partnerOrganisationId", "validTo");

-- AddForeignKey
ALTER TABLE "KindAuthorisation" ADD CONSTRAINT "KindAuthorisation_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES "PartnerOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KindAuthorisation" ADD CONSTRAINT "KindAuthorisation_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerOrganisationAuditEntry" ADD CONSTRAINT "PartnerOrganisationAuditEntry_kindAuthorisationId_fkey" FOREIGN KEY ("kindAuthorisationId") REFERENCES "KindAuthorisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
