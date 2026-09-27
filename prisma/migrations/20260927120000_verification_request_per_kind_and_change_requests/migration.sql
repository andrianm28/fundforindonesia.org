-- Per-Kind verification checklists and change requests on Active Campaigns
-- (prd-compliance 12, PRD FFI-05 and §7.1). Additive:
-- - VerificationChecklistItem gains a nullable `kind`: null is the "Semua"
--   row, snapshotted for every Kind; a set Kind scopes the item to that
--   Kind's submissions, so the Admin editor can later diverge one Kind's
--   checklist without touching another's.
-- - VerificationRequest gains a nullable `proposedChanges`: the new target
--   and/or deadline an Active Campaign keeps running without until a
--   Verifier approves the request. Null on submissions from Draft/Rejected.
-- - Seeds the §7.1 per-Kind documents for zakat and wakaf. Hibah starts
--   seeded identical to wakaf's items (CSR-11 sequencing decision
--   2026-09-27; ADR 0013 placeholder), for the Admin to diverge from the
--   panel once the sharia review lands. Positions continue past whatever
--   Admin-added items already exist, so this never collides with them.

-- AlterTable
ALTER TABLE "VerificationChecklistItem" ADD COLUMN "kind" "Kind";

-- AlterTable
ALTER TABLE "VerificationRequest" ADD COLUMN "proposedChanges" JSONB;

-- CreateIndex
CREATE INDEX "VerificationChecklistItem_kind_active_position_idx" ON "VerificationChecklistItem"("kind", "active", "position");

-- Seed the per-Kind documents of PRD §7.1. Stable ids, like the "Semua"
-- seed before them. Hibah's rows are wakaf's rows under another Kind.
INSERT INTO "VerificationChecklistItem" ("id", "label", "required", "position", "active", "kind")
SELECT v.id, v.label, v.required,
       (SELECT COALESCE(MAX(position), 0) FROM "VerificationChecklistItem") + v.ord,
       v.active, v.kind::"Kind"
FROM (VALUES
  ('wakaf-lembaga-nazhir', 'Dokumen lembaga nazhir sesuai ketentuan Platform Operator', true, true, 'WAKAF', 1),
  ('wakaf-draf-akad', 'Draf akad wakaf', true, true, 'WAKAF', 2),
  ('wakaf-kind-authorisation', 'Kind Authorisation wakaf', true, true, 'WAKAF', 3),
  ('zakat-lembaga-amil', 'Dokumen lembaga amil sesuai ketentuan Platform Operator', true, true, 'ZAKAT', 4),
  ('zakat-kind-authorisation', 'Kind Authorisation zakat', true, true, 'ZAKAT', 5),
  ('hibah-lembaga-nazhir', 'Dokumen lembaga nazhir sesuai ketentuan Platform Operator', true, true, 'HIBAH', 6),
  ('hibah-draf-akad', 'Draf akad wakaf', true, true, 'HIBAH', 7),
  ('hibah-kind-authorisation', 'Kind Authorisation wakaf', true, true, 'HIBAH', 8)
) AS v(id, label, required, active, kind, ord);
