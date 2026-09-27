-- AlterTable
ALTER TABLE "Donation" ADD COLUMN     "ikrarConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AkadWakaf" (
    "id" TEXT NOT NULL,
    "donationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AkadWakaf_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AkadWakaf_donationId_key" ON "AkadWakaf"("donationId");

-- CreateIndex
CREATE UNIQUE INDEX "AkadWakaf_token_key" ON "AkadWakaf"("token");

-- AddForeignKey
ALTER TABLE "AkadWakaf" ADD CONSTRAINT "AkadWakaf_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
