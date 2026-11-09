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
-- Rollback (by hand, if ever needed): DROP the three indexes and two FKs below,
-- ALTER TABLE ... DROP COLUMN for the five new columns, DROP TYPE
-- "MerchantEntity". Dropping columns is not an UPDATE, so the trigger does not
-- stand in the way.

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

-- CreateIndex
CREATE INDEX "LedgerEntry_account_merchantEntity_provider_idx" ON "LedgerEntry"("account", "merchantEntity", "provider");

-- CreateIndex
CREATE INDEX "LedgerEntry_collectingEntityId_idx" ON "LedgerEntry"("collectingEntityId");

-- CreateIndex
CREATE INDEX "LedgerEntry_actorId_idx" ON "LedgerEntry"("actorId");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_collectingEntityId_fkey" FOREIGN KEY ("collectingEntityId") REFERENCES "PartnerOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
