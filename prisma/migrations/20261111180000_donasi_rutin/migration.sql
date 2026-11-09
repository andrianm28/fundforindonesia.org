-- Donasi rutin (PKS pemenuhan 18, pasal 4.7).
--
-- RecurringDonation is a Donor's standing intention to give to one Campaign
-- every period; RecurringDonationCycle is one billed cycle. Nothing here
-- charges anything: the scheduled job issues an ordinary Donation + payment
-- link per cycle through the existing donation path. The unique
-- (recurringId, cycleIndex) is the idempotency key (one bill per cycle however
-- often the job runs). A cycle's status is derived from its Donation, never
-- stored.
--
-- AutoDonation (the old daily/weekly auto-donate model, parked by
-- prd-compliance-fase-0-2/01, read and written by no code since) is dropped:
-- its shape (category, daily/weekly, clock time) fits none of this, and a
-- table nothing reads is a second, unledgered way to describe money intent.
-- Its rows, if any, go with it.

-- CreateEnum
CREATE TYPE "RecurringDonationPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY');

-- CreateEnum
CREATE TYPE "RecurringDonationStatus" AS ENUM ('ACTIVE', 'STOPPED');

-- DropForeignKey
ALTER TABLE "AutoDonation" DROP CONSTRAINT "AutoDonation_userId_fkey";

-- DropTable
DROP TABLE "AutoDonation";

-- CreateTable
CREATE TABLE "RecurringDonation" (
    "id" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "period" "RecurringDonationPeriod" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "status" "RecurringDonationStatus" NOT NULL DEFAULT 'ACTIVE',
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringDonation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringDonationCycle" (
    "id" TEXT NOT NULL,
    "recurringId" TEXT NOT NULL,
    "cycleIndex" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "donationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringDonationCycle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringDonation_donorId_idx" ON "RecurringDonation"("donorId");

-- CreateIndex
CREATE INDEX "RecurringDonation_status_idx" ON "RecurringDonation"("status");

-- CreateIndex
CREATE INDEX "RecurringDonation_campaignId_idx" ON "RecurringDonation"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringDonationCycle_donationId_key" ON "RecurringDonationCycle"("donationId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringDonationCycle_recurringId_cycleIndex_key" ON "RecurringDonationCycle"("recurringId", "cycleIndex");

-- AddForeignKey
ALTER TABLE "RecurringDonation" ADD CONSTRAINT "RecurringDonation_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringDonation" ADD CONSTRAINT "RecurringDonation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringDonationCycle" ADD CONSTRAINT "RecurringDonationCycle_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringDonation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringDonationCycle" ADD CONSTRAINT "RecurringDonationCycle_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
