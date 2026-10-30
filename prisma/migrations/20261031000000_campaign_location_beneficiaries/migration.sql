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

-- A beneficiary count, when given, is positive. Every existing row is NULL,
-- so adding the constraint cannot fail on current data.
ALTER TABLE "Campaign"
    ADD CONSTRAINT "Campaign_beneficiaryCount_positive"
    CHECK ("beneficiaryCount" IS NULL OR "beneficiaryCount" > 0);
