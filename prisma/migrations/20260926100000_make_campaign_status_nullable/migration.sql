-- The legacy Campaign status string is no longer written or read
-- (legacy-status-contract 02); lifecycleStatus is the one status column.
-- Additive: existing values stay, new rows get NULL. The column and its index
-- are dropped by a later migration, once this code is live (ticket 03).

-- AlterTable
ALTER TABLE "Campaign" ALTER COLUMN "status" DROP NOT NULL,
ALTER COLUMN "status" DROP DEFAULT;
