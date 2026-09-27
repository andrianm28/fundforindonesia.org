-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "donationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_donationId_key" ON "Receipt"("donationId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_token_key" ON "Receipt"("token");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
