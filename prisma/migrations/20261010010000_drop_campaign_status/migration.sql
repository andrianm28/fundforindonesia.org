-- Contract step of legacy-status-contract (ticket 03, rilis-1 62): the legacy
-- Campaign status string was made nullable and stopped being read or written by
-- 20260926100000 and its code, which is live in production. lifecycleStatus is
-- the one status column. Dropping the column drops its indexes with it; they
-- are named here so the intent is on the page.

-- DropIndex
DROP INDEX "Campaign_status_idx";

-- DropIndex
DROP INDEX "Campaign_isUrgent_status_idx";

-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN "status";
