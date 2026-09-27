-- ADR 0012 for the Partnership Inquiry's contact fields (ticket csr-05).
-- The public partnership form collects a named person's email and phone, so
-- they are the same contact data User.email/User.phone and
-- Donation.guestEmail/guestPhone already carry; leaving them plaintext would
-- mean the same form writing contact details under two different rules.
--
-- Additive only, the same expand step as
-- 20260927010000_add_contact_field_encryption: nullable sealed columns beside
-- the plaintext they protect, plus an index on the searchable email HMAC. The
-- plaintext stays and stays written, so the partnership team and the
-- notification email keep working (ADR 0012 stores both forms on purpose).
-- contactName and companyName get nothing: names stay readable by decision.
-- Nothing is backfilled -- no company has submitted an Inquiry yet.

-- AlterTable
ALTER TABLE "PartnershipInquiry" ADD COLUMN     "contactEmailHmac" TEXT,
ADD COLUMN     "contactEmailHmacKeyId" TEXT,
ADD COLUMN     "contactEmailCiphertext" TEXT,
ADD COLUMN     "contactEmailKeyId" TEXT,
ADD COLUMN     "contactPhoneCiphertext" TEXT,
ADD COLUMN     "contactPhoneKeyId" TEXT;

-- CreateIndex
CREATE INDEX "PartnershipInquiry_contactEmailHmac_idx" ON "PartnershipInquiry"("contactEmailHmac");
