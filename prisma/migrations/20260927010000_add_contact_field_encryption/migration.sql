-- Field-level encryption, expand step (prd-compliance 15; ADR 0012).
-- Additive only: nullable columns beside the plaintext they protect, plus an
-- index on the searchable email HMAC. Existing rows keep NULL here until the
-- backfill; nothing is dropped, renamed or rewritten.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailCiphertext" TEXT,
ADD COLUMN     "emailHmac" TEXT,
ADD COLUMN     "emailHmacKeyId" TEXT,
ADD COLUMN     "emailKeyId" TEXT,
ADD COLUMN     "phoneCiphertext" TEXT,
ADD COLUMN     "phoneKeyId" TEXT;

-- AlterTable
ALTER TABLE "BankAccount" ADD COLUMN     "accountNumberCiphertext" TEXT,
ADD COLUMN     "accountNumberKeyId" TEXT;

-- CreateIndex
CREATE INDEX "User_emailHmac_idx" ON "User"("emailHmac");
