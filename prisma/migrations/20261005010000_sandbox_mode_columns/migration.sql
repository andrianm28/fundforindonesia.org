-- Sandbox mode columns (tickets rilis-1-benda/92 and 94). Payment records whether
-- it was created while the public beta marker (BETA_SANDBOX) was on; LedgerEntry,
-- Payout, Refund and UsageReport get the same column so ticket 94 can stamp them
-- from their source Payment. Additive, default false: every existing row is live
-- money, which is what it was. Only Payment is filled and read so far.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "sandbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "sandbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "sandbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "sandbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "UsageReport" ADD COLUMN     "sandbox" BOOLEAN NOT NULL DEFAULT false;
