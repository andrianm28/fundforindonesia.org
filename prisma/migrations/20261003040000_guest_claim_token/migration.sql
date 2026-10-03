-- Guest Donor claim-by-email (prd-audit 08): a one-use, 24 hour link sent to a
-- signed-in account's verified address; opening it links the Guest Donations
-- under that address to the account.
--
-- Additive: one table. Only a SHA-256 of the token is stored, and the address
-- is held only as the account's HMAC lookup and key id at issue.

-- CreateTable
CREATE TABLE "GuestClaimToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "emailHmac" TEXT NOT NULL,
    "emailHmacKeyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestClaimToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestClaimToken_tokenHash_key" ON "GuestClaimToken"("tokenHash");

-- CreateIndex
CREATE INDEX "GuestClaimToken_userId_createdAt_idx" ON "GuestClaimToken"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "GuestClaimToken" ADD CONSTRAINT "GuestClaimToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
