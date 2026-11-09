-- Data verifikasi penggalang dana (PKS pemenuhan 08, pasal 3.2).
--
-- 1. PartnerOrganisation: address and the person responsible (name, position,
--    telephone). The telephone is sealed under ADR 0012 like every other phone
--    number (ciphertext + key id, no HMAC, never searched); name, position and
--    address stay plaintext. All nullable: an organisation registered before
--    this column existed has none, and the Verifier fills it in from the
--    register.
-- 2. Campaign.beneficiaryRelationship: a short free-text field.
-- 3. Two scopes on VerificationChecklistItem: `requestKinds` (which kinds of
--    Verification Request snapshot the item; every existing row keeps all
--    three) and `applicant` (INDIVIDUAL, ORGANISATION, or NULL for both).
-- 4. Five VerificationChecklistItem rows ("Semua" by Kind, kind NULL), for a
--    SUBMISSION only: a live Campaign approved before they existed would
--    otherwise snapshot required, documented items into its CHANGE or
--    AMOUNT_REVIEW request that its Fundraiser can never satisfy, and a
--    Verifier could not approve it. The foto diri memegang KTP asks an
--    individual, the surat kuasa an organisation, the rest both. Stable ids and ON CONFLICT DO NOTHING make the
--    seed idempotent, and an Admin who has since reworded, deactivated or
--    reordered one in the panel is never overwritten. Positions continue past
--    whatever is there, as the earlier seeds do. The surat kuasa is optional
--    ("bila diperlukan"); the others are required. All five are papers, so
--    they need an uploaded Document before a Verifier may tick them (ticket 64).

-- AlterTable
ALTER TABLE "PartnerOrganisation" ADD COLUMN     "address" TEXT,
ADD COLUMN     "responsiblePersonName" TEXT,
ADD COLUMN     "responsiblePersonPhoneCiphertext" TEXT,
ADD COLUMN     "responsiblePersonPhoneKeyId" TEXT,
ADD COLUMN     "responsiblePersonTitle" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "beneficiaryRelationship" TEXT;

-- CreateEnum
CREATE TYPE "ChecklistApplicant" AS ENUM ('INDIVIDUAL', 'ORGANISATION');

-- AlterTable
ALTER TABLE "VerificationChecklistItem" ADD COLUMN     "applicant" "ChecklistApplicant",
ADD COLUMN     "requestKinds" "VerificationRequestKind"[] DEFAULT ARRAY['SUBMISSION', 'CHANGE', 'AMOUNT_REVIEW']::"VerificationRequestKind"[];

INSERT INTO "VerificationChecklistItem" ("id", "label", "required", "position", "active", "kind", "requiresDocument", "requestKinds", "applicant")
SELECT v.id, v.label, v.required,
       (SELECT COALESCE(MAX(position), 0) FROM "VerificationChecklistItem") + v.ord,
       true, NULL, true, ARRAY['SUBMISSION']::"VerificationRequestKind"[], v.applicant::"ChecklistApplicant"
FROM (VALUES
  ('foto-diri-memegang-ktp', 'Foto diri memegang KTP', true, 1, 'INDIVIDUAL'),
  ('bukti-alamat', 'Bukti alamat penggalang dana', true, 2, NULL),
  ('bukti-hubungan-penerima-manfaat', 'Bukti hubungan dengan penerima manfaat', true, 3, NULL),
  ('surat-kuasa-lembaga', 'Surat kuasa (lembaga, bila diperlukan)', false, 4, 'ORGANISATION'),
  ('dokumen-pendukung-program', 'Dokumen pendukung program', true, 5, NULL)
) AS v(id, label, required, ord, applicant)
ON CONFLICT ("id") DO NOTHING;
