-- Duplicate Campaign hints for a Verifier (prd-compliance 14, PRD FFI-05).
-- Additive: one column, one table, two indexes, one seeded checklist item.
--
-- pg_trgm is enabled HERE, not assumed. A Verifier's duplicate hints are
-- built from `similarity()`, which exists only once this extension does, so
-- a database that never ran this migration cannot answer the question at
-- all. `IF NOT EXISTS` covers both directions: a managed database that
-- already ships pg_trgm is left alone, and a plain one gets it created. A
-- role without the right to create extensions fails the migration loudly at
-- deploy time, which is the outcome we want -- the alternative is a
-- `function similarity(text, text) does not exist` on the Verifier's page
-- the first time somebody opens a Campaign to review.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
-- The beneficiary this Campaign names (PRD FFI-02, FFI-05). Plaintext, not
-- encrypted, on purpose: ADR 0012 keeps names readable so they can be
-- compared, and "identical beneficiary name" is one of the three matches a
-- Verifier's hints are built from. Nullable until a Campaign form writes
-- one; a Campaign that names none matches no other on this.
ALTER TABLE "Campaign" ADD COLUMN "beneficiaryName" TEXT;

-- CreateTable
-- The title similarity above which two Campaigns count as alike, as an Admin
-- sets it (PRD FFI-05: "ambang 0,6 diatur Admin"). Append-only, exactly like
-- PlatformFeeThreshold: `setById` and `setAt` are the "who and when" record,
-- and the threshold a hint was matched under stays readable after a change.
-- No row is seeded -- the 0.6 the PRD states is the default in code, the same
-- way an unset Platform Fee resolves to 0 bps rather than to a guess.
CREATE TABLE "DuplicateSimilarityThreshold" (
    "id" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "setById" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateSimilarityThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The trigram index is what makes `similarity()` usable as a search rather
-- than a scan of every Campaign -- it answers the `similarity() >= constant`
-- form, which is what the statement in src/lib/duplicate-hints.ts asks for
-- with a bound parameter. The plain btree is the beneficiary name's exact
-- match. Both are declared the same way in schema.prisma, under the names
-- Prisma itself derives ("Campaign_title_idx"), or CI's `migrate diff` would
-- find an index the schema does not know about.
CREATE INDEX "Campaign_title_idx" ON "Campaign" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "Campaign_beneficiaryName_idx" ON "Campaign"("beneficiaryName");
CREATE INDEX "DuplicateSimilarityThreshold_setAt_idx" ON "DuplicateSimilarityThreshold"("setAt");

-- AddForeignKey
ALTER TABLE "DuplicateSimilarityThreshold" ADD CONSTRAINT "DuplicateSimilarityThreshold_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the checklist's "bukan duplikat" item (PRD FFI-05). An ordinary
-- "Semua" row -- kind NULL -- so every Kind's submission snapshots it through
-- the same path as every other item, and the Verifier's tick on it travels
-- with the Verification Request rather than being a note somewhere else.
-- Required, because a Verifier passing a Campaign is asserting this, and an
-- assertion that is not recorded is the same as hiding the duplicate check.
-- The position continues past whatever the Admin has added, so this never
-- collides with a row already there.
INSERT INTO "VerificationChecklistItem" ("id", "label", "required", "position", "active", "kind")
SELECT v.id, v.label, v.required,
       (SELECT COALESCE(MAX(position), 0) FROM "VerificationChecklistItem") + v.ord,
       v.active, v.kind::"Kind"
FROM (VALUES
  ('bukan-duplikat', 'Sudah dipastikan bukan duplikat Campaign lain', true, true, NULL, 1)
) AS v(id, label, required, active, kind, ord);
