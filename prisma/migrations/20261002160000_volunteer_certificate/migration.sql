-- Ticket 37: Sertifikat Keikutsertaan, plus the stored payment instructions a
-- HOLD Registration needs for "Lanjutkan pembayaran". Both changes are purely
-- additive: a new table, and two NULLable columns that every existing Payment
-- row simply holds as NULL.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "redirectUrl" TEXT,
ADD COLUMN "vaNumber" TEXT;

-- CreateTable
CREATE TABLE "VolunteerCertificate" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "volunteerName" TEXT NOT NULL,
    "tripTitle" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "batchStartDate" TIMESTAMP(3) NOT NULL,
    "batchEndDate" TIMESTAMP(3) NOT NULL,
    "organizerName" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolunteerCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerCertificate_registrationId_key" ON "VolunteerCertificate"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerCertificate_code_key" ON "VolunteerCertificate"("code");

-- AddForeignKey
ALTER TABLE "VolunteerCertificate" ADD CONSTRAINT "VolunteerCertificate_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
