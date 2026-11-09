-- Two Merchant Accounts inside FFI (ADR 0027, extending ADR 0011): the ledger,
-- the Payment and the ProviderWithdrawal learn which merchant entity (YAYASAN
-- or BADAN_USAHA) their money belongs to. PKS Pasal 4.1(2), 10(4), 4.3.
--
-- BACKFILL AND THE APPEND-ONLY TRIGGER. "LedgerEntry_append_only"
-- (20261016090000_ledger_integrity) rejects every UPDATE and DELETE on the
-- ledger, and every ledger row that exists today is a yayasan row. This
-- migration backfills WITHOUT an UPDATE and therefore without touching the
-- trigger at all: it adds the column as NOT NULL DEFAULT 'YAYASAN', which
-- PostgreSQL (11+) applies to existing rows as catalog metadata, no row is
-- rewritten and no row trigger fires, and then drops the DEFAULT so that every
-- future row must name its entity (postTransaction requires it). The trigger is
-- never disabled, so there is no moment, however short, at which the ledger
-- is mutable. src/__tests__/merchant-entity-migration.test.ts runs this against
-- a database that already holds ledger rows and asserts the backfill, that
-- UPDATE/DELETE are still refused afterwards, and that an insert naming no
-- entity is refused.
--
-- collectingEntityId and actorId are new and null for old rows: nobody recorded
-- them, and null is the honest value (the same stance as LedgerEntry.provider).
--
-- WebhookEvent gets the same column, backfilled the same way (YAYASAN, the only
-- endpoint that existed), and its unique key becomes (provider, merchantEntity,
-- providerEventId): two merchants are two accounts at the provider, and an event
-- id seen on one must not turn the same id on the other into a dropped "replay".
--
-- LOCKING, AND WHEN TO RUN THIS. Run it in a QUIET PERIOD (no donations or
-- webhooks in flight). Prisma runs a migration in one transaction, so
-- CREATE INDEX CONCURRENTLY is not available, and a plain CREATE INDEX blocks
-- writes to its table while it builds. To keep the blocking short:
--   * the two foreign keys are added NOT VALID (no scan, only a brief lock) and
--     validated in a SEPARATE statement (VALIDATE CONSTRAINT takes only a
--     SHARE UPDATE EXCLUSIVE lock, which does not block INSERTs into the ledger);
--   * the indexes on the two mostly-null columns are PARTIAL
--     (WHERE ... IS NOT NULL), so they hold almost nothing to build;
--   * what is left that does block is the (account, merchantEntity, provider)
--     index on LedgerEntry and the WebhookEvent unique-index swap, which are
--     proportional to the table size. That is the reason for the quiet period.
-- The two partial indexes cannot be written in schema.prisma, so they live only
-- here (the same arrangement as LedgerEntry_transactionId_claim_key);
-- `prisma migrate diff` ignores partial indexes and stays empty.
--
-- Rollback (by hand, if ever needed): DROP the indexes and FKs below, restore
-- WebhookEvent_provider_providerEventId_key, ALTER TABLE ... DROP COLUMN for the
-- new columns, DROP TYPE "MerchantEntity". Dropping columns is not an UPDATE, so
-- the trigger does not stand in the way.

-- CreateEnum
CREATE TYPE "MerchantEntity" AS ENUM ('YAYASAN', 'BADAN_USAHA');

-- AlterTable: the ledger. Backfill = YAYASAN, via the column default; then the
-- default goes, so a posting that forgets its entity fails instead of being
-- booked to the yayasan.
ALTER TABLE "LedgerEntry" ADD COLUMN "merchantEntity" "MerchantEntity" NOT NULL DEFAULT 'YAYASAN';
ALTER TABLE "LedgerEntry" ALTER COLUMN "merchantEntity" DROP DEFAULT;
ALTER TABLE "LedgerEntry" ADD COLUMN "collectingEntityId" TEXT,
ADD COLUMN "actorId" TEXT;

-- AlterTable: every Payment and sweep that exists was a yayasan one, and the
-- default stays (new rows are written explicitly by the charge code).
ALTER TABLE "Payment" ADD COLUMN "merchantEntity" "MerchantEntity" NOT NULL DEFAULT 'YAYASAN';
ALTER TABLE "ProviderWithdrawal" ADD COLUMN "merchantEntity" "MerchantEntity" NOT NULL DEFAULT 'YAYASAN';

-- AlterTable: the webhook idempotency key learns the merchant. Backfill via the
-- same ADD COLUMN DEFAULT then DROP DEFAULT (metadata only, no UPDATE).
ALTER TABLE "WebhookEvent" ADD COLUMN "merchantEntity" "MerchantEntity" NOT NULL DEFAULT 'YAYASAN';
ALTER TABLE "WebhookEvent" ALTER COLUMN "merchantEntity" DROP DEFAULT;

-- DropIndex
DROP INDEX "WebhookEvent_provider_providerEventId_key";

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_merchantEntity_providerEventId_key" ON "WebhookEvent"("provider", "merchantEntity", "providerEventId");

-- CreateIndex
CREATE INDEX "LedgerEntry_account_merchantEntity_provider_idx" ON "LedgerEntry"("account", "merchantEntity", "provider");

-- CreateIndex: partial, both columns are null on nearly every row. Not
-- expressible in schema.prisma (see the header).
CREATE INDEX "LedgerEntry_collectingEntityId_idx" ON "LedgerEntry"("collectingEntityId") WHERE "collectingEntityId" IS NOT NULL;

-- CreateIndex: partial, as above.
CREATE INDEX "LedgerEntry_actorId_idx" ON "LedgerEntry"("actorId") WHERE "actorId" IS NOT NULL;

-- AddForeignKey: NOT VALID first, validated in its own statement below, so the
-- table is not held under the stronger lock for a scan.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_collectingEntityId_fkey" FOREIGN KEY ("collectingEntityId") REFERENCES "PartnerOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- Validate (separate statements, SHARE UPDATE EXCLUSIVE only)
ALTER TABLE "LedgerEntry" VALIDATE CONSTRAINT "LedgerEntry_collectingEntityId_fkey";

ALTER TABLE "LedgerEntry" VALIDATE CONSTRAINT "LedgerEntry_actorId_fkey";
