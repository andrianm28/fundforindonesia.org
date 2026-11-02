-- Structured location and beneficiaries on a Campaign (ticket 74, decision
-- C8). Four nullable columns only: ADD COLUMN without a default is a
-- catalog-only change in Postgres, no existing row is rewritten, and the
-- legacy free-text "location" column is left untouched.

-- AlterTable
ALTER TABLE "Campaign"
    ADD COLUMN "province" TEXT,
    ADD COLUMN "regency" TEXT,
    ADD COLUMN "beneficiaryDescription" TEXT,
    ADD COLUMN "beneficiaryCount" INTEGER;

-- A beneficiary count, when given, is positive. NOT VALID: every new or
-- updated row is checked, but rows already in the table are not scanned, so
-- the migration cannot fail on existing data (all are NULL today). Same
-- pattern as 20261016090000_ledger_integrity; VALIDATE CONSTRAINT is left
-- out on purpose.
ALTER TABLE "Campaign"
    ADD CONSTRAINT "Campaign_beneficiaryCount_positive"
    CHECK ("beneficiaryCount" IS NULL OR "beneficiaryCount" > 0) NOT VALID;
