-- AlterEnum
ALTER TYPE "LedgerAccount" ADD VALUE 'TRIP_BALANCE';

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "donationId" DROP NOT NULL;
ALTER TABLE "Payment" ADD COLUMN "registrationId" TEXT;
CREATE UNIQUE INDEX "Payment_registrationId_key" ON "Payment"("registrationId");

-- AlterTable
ALTER TABLE "Payout" ALTER COLUMN "campaignId" DROP NOT NULL;
ALTER TABLE "Payout" ADD COLUMN "volunteerTripId" TEXT;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN "volunteerTripId" TEXT;

-- CreateIndex
CREATE INDEX "Payout_volunteerTripId_status_idx" ON "Payout"("volunteerTripId", "status");

-- CreateIndex
CREATE INDEX "LedgerEntry_account_volunteerTripId_idx" ON "LedgerEntry"("account", "volunteerTripId");
