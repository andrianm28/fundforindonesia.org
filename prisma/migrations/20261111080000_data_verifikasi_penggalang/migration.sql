-- Data verifikasi penggalang dana (PKS pemenuhan 08, pasal 3.2).
--
-- 1. PartnerOrganisation: address and the person responsible (name, position,
--    telephone). The telephone is sealed under ADR 0012 like every other phone
--    number (ciphertext + key id, no HMAC, never searched); name, position and
--    address stay plaintext. All nullable: an organisation registered before
--    this column existed has none, and the Verifier fills it in from the
--    register.
-- 2. Campaign.beneficiaryRelationship: a short free-text field.
-- 3. Five VerificationChecklistItem rows ("Semua", kind NULL, so every Kind's
--    submission snapshots them). Stable ids and ON CONFLICT DO NOTHING make the
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

INSERT INTO "VerificationChecklistItem" ("id", "label", "required", "position", "active", "kind", "requiresDocument")
SELECT v.id, v.label, v.required,
       (SELECT COALESCE(MAX(position), 0) FROM "VerificationChecklistItem") + v.ord,
       true, NULL, true
FROM (VALUES
  ('foto-diri-memegang-ktp', 'Foto diri memegang KTP', true, 1),
  ('bukti-alamat', 'Bukti alamat penggalang dana', true, 2),
  ('bukti-hubungan-penerima-manfaat', 'Bukti hubungan dengan penerima manfaat', true, 3),
  ('surat-kuasa-lembaga', 'Surat kuasa (lembaga, bila diperlukan)', false, 4),
  ('dokumen-pendukung-program', 'Dokumen pendukung program', true, 5)
) AS v(id, label, required, ord)
ON CONFLICT ("id") DO NOTHING;
