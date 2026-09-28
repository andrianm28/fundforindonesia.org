-- The Collection Account and the per-provider Provider Balance (prd-compliance
-- 35, PRD FFI-07; ADR 0011).
--
-- Three things, all additive and all nullable-by-default where a backfill
-- would have to guess:
--
--   1. a new LedgerAccount value, COLLECTION_ACCOUNT: the rekening
--      penghimpunan, which CONTEXT.md is explicit is a DIFFERENT thing from the
--      Merchant Account and may belong to a different legal entity;
--   2. LedgerEntry.provider, so the Provider Balance can be read per provider
--      (CONTEXT.md: "Tercatat sebagai akun buku besar tersendiri per
--      penyedia"), and LedgerEntry.providerWithdrawalId, which attributes a
--      pot movement to the recorded sweep that caused it;
--   3. the ProviderWithdrawal table itself, plus the provider balance an
--      approving Admin read in the dashboard before approving a Payout.
--
-- EVERY COLUMN IS LEFT NULL WHERE HISTORY CANNOT ANSWER IT. There is no
-- backfill, and that is a decision rather than an omission. The Provider
-- Balance is debited on every Settlement, and a Settlement's provider is
-- readable today by joining LedgerEntry.paymentId to Payment.provider -- so a
-- backfill COULD fill LedgerEntry.provider for the debits. It is not filled,
-- because the credits (a completed Payout, a paid Refund) name no provider
-- anywhere in this database, and backfilling one side of an account while
-- leaving the other side null would produce a per-provider figure that looks
-- computed and is silently a floor. A null in that column means "nobody
-- recorded which provider this was", and every reader treats it as its own
-- bucket rather than folding it into a named provider. That is the same
-- refusal as Campaign.collectedAmount: where the books and a derived figure
-- disagree, the ledger is right and the gap is reported.
--
-- As in the ledger claim migration, Prisma does NOT wrap this file in a
-- transaction, so a failure part-way leaves the earlier statements applied and
-- this migration unrecorded. Every statement is therefore re-runnable.

-- 1. The new account. ADD VALUE IF NOT EXISTS so a re-run is a no-op. The new
-- value is not used by any later statement in THIS migration, which is the one
-- thing Postgres forbids inside a transaction on older versions; nothing here
-- is wrapped in one.
ALTER TYPE "LedgerAccount" ADD VALUE IF NOT EXISTS 'COLLECTION_ACCOUNT';

-- 2. Which provider a movement went through, and which recorded sweep took the
-- money to the bank. Both nullable, both null on every existing row: see the
-- header for why nothing is backfilled.
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "providerWithdrawalId" TEXT;

-- The ProviderWithdrawal table. "reference" is UNIQUE and that is the claim
-- that makes recording a given sweep happen once ever: the provider issues one
-- reference per disbursement, so the same reference twice is the same money
-- claimed twice. ON DELETE RESTRICT on both foreign keys, matching every other
-- money table in this schema -- these rows are audit records and are never
-- deleted from under a ledger entry that names one.
CREATE TABLE IF NOT EXISTS "ProviderWithdrawal" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "destinationName" TEXT NOT NULL,
    "collectingEntityId" TEXT,
    "providerBalanceBefore" INTEGER NOT NULL,
    "providerBalanceAfter" INTEGER NOT NULL,
    "proofReference" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderWithdrawal_reference_key" ON "ProviderWithdrawal"("reference");
CREATE INDEX IF NOT EXISTS "ProviderWithdrawal_provider_recordedAt_idx" ON "ProviderWithdrawal"("provider", "recordedAt");

DO $$ BEGIN
  ALTER TABLE "ProviderWithdrawal" ADD CONSTRAINT "ProviderWithdrawal_collectingEntityId_fkey"
    FOREIGN KEY ("collectingEntityId") REFERENCES "PartnerOrganisation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProviderWithdrawal" ADD CONSTRAINT "ProviderWithdrawal_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Added after the table, so a re-run does not fail on a constraint whose target
-- has to exist first.
--
-- ON DELETE SET NULL, not RESTRICT, and that is not a preference: the relation
-- is OPTIONAL, and Prisma's referential default for an optional relation is
-- SET NULL. Every other LedgerEntry subject FK in this schema behaves the same
-- way (LedgerEntry_campaignId_fkey in the money-layer migration,
-- LedgerEntry_manualContributionId_fkey in prd-compliance 34), and a mismatch
-- here is exactly what CI's `migrations` job diffs for.
DO $$ BEGIN
  ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_providerWithdrawalId_fkey"
    FOREIGN KEY ("providerWithdrawalId") REFERENCES "ProviderWithdrawal"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. The provider balance an approving Admin read before approving a Payout
-- (FFI-07 story 53). Nullable so a Payout approved before this column existed
-- keeps its history rather than being backfilled with a figure nobody wrote.
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "approvedProvider" TEXT;
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "approvedProviderBalance" INTEGER;

-- The indexes Prisma's schema declares, created here so a migrated database
-- and the schema agree (CI's `migrations` job diffs them).
CREATE INDEX IF NOT EXISTS "LedgerEntry_account_provider_idx" ON "LedgerEntry"("account", "provider");
CREATE INDEX IF NOT EXISTS "LedgerEntry_providerWithdrawalId_idx" ON "LedgerEntry"("providerWithdrawalId");
