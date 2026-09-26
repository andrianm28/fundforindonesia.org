-- CreateEnum
CREATE TYPE "VolunteerTripStatusChangeAction" AS ENUM ('SUBMITTED', 'SUBMISSION_APPROVED', 'SUBMISSION_REJECTED');

-- CreateTable
CREATE TABLE "VolunteerTripStatusChange" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "action" "VolunteerTripStatusChangeAction" NOT NULL,
    "fromStatus" "VolunteerTripStatus" NOT NULL,
    "toStatus" "VolunteerTripStatus" NOT NULL,
    "actorId" TEXT,
    "capacity" "StatusChangeCapacity" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolunteerTripStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VolunteerTripStatusChange_tripId_createdAt_idx" ON "VolunteerTripStatusChange"("tripId", "createdAt");

-- AddForeignKey
ALTER TABLE "VolunteerTripStatusChange" ADD CONSTRAINT "VolunteerTripStatusChange_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "VolunteerTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerTripStatusChange" ADD CONSTRAINT "VolunteerTripStatusChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

