-- CreateEnum
CREATE TYPE "VolunteerTripStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REJECTED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "VolunteerBatchStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED', 'COMPLETED');

-- CreateTable
CREATE TABLE "VolunteerTrip" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "story" TEXT NOT NULL,
    "coverImage" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "itinerary" TEXT NOT NULL,
    "tripFeeAmount" INTEGER NOT NULL,
    "status" "VolunteerTripStatus" NOT NULL DEFAULT 'DRAFT',
    "fundraiserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolunteerTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerBatch" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "registrationDeadline" TIMESTAMP(3) NOT NULL,
    "maxQuota" INTEGER NOT NULL,
    "minQuota" INTEGER NOT NULL,
    "status" "VolunteerBatchStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolunteerBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerTrip_slug_key" ON "VolunteerTrip"("slug");

-- CreateIndex
CREATE INDEX "VolunteerTrip_slug_idx" ON "VolunteerTrip"("slug");

-- CreateIndex
CREATE INDEX "VolunteerTrip_status_idx" ON "VolunteerTrip"("status");

-- CreateIndex
CREATE INDEX "VolunteerTrip_fundraiserId_idx" ON "VolunteerTrip"("fundraiserId");

-- CreateIndex
CREATE INDEX "VolunteerBatch_tripId_idx" ON "VolunteerBatch"("tripId");

-- CreateIndex
CREATE INDEX "VolunteerBatch_status_idx" ON "VolunteerBatch"("status");

-- AddForeignKey
ALTER TABLE "VolunteerTrip" ADD CONSTRAINT "VolunteerTrip_fundraiserId_fkey" FOREIGN KEY ("fundraiserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerBatch" ADD CONSTRAINT "VolunteerBatch_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "VolunteerTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
