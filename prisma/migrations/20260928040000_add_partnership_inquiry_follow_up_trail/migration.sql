-- The follow-up trail of a Partnership Inquiry (csr-06; CONTEXT.md,
-- Partnership Inquiry). Ticket csr-05 created the Inquiry with a status and
-- left it at NOT_YET_FOLLOWED_UP; this adds the append-only log of who moved
-- it, from which status to which, and when, so that "who followed this up,
-- and when" has one answer that outlives whoever is on the team now.
--
-- Additive: one new table and two foreign keys, both ON DELETE RESTRICT like
-- CampaignStatusChange, so deleting an Inquiry or a person cannot erase a
-- follow-up. Nothing is backfilled -- no company has been followed up with
-- yet, and an Inquiry's first status is simply where it starts. Nothing here
-- reaches Donation, Payment, Refund, Payout or the ledger: an Inquiry is a
-- conversation about a Program, and a Program takes no money (ADR 0002).

-- CreateTable
CREATE TABLE "PartnershipInquiryStatusChange" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "fromStatus" "PartnershipInquiryStatus" NOT NULL,
    "toStatus" "PartnershipInquiryStatus" NOT NULL,
    "actedById" TEXT NOT NULL,
    "actedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnershipInquiryStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnershipInquiryStatusChange_inquiryId_actedAt_idx" ON "PartnershipInquiryStatusChange"("inquiryId", "actedAt");

-- AddForeignKey
ALTER TABLE "PartnershipInquiryStatusChange" ADD CONSTRAINT "PartnershipInquiryStatusChange_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "PartnershipInquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnershipInquiryStatusChange" ADD CONSTRAINT "PartnershipInquiryStatusChange_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
