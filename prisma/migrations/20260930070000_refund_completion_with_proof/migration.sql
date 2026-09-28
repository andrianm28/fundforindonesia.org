-- Refund completion with proof (ticket 31; CONTEXT.md, Refund; PRD §7.2;
-- ADR 0007; ADR 0012). Additive only: nullable columns and one foreign key.
-- No backfill -- a completedById of null means "nobody has recorded this
-- Refund as paid", true of every existing row, and every donor destination
-- column is null until an Admin types one in at completion.

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "completedById" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "proofImage" TEXT,
ADD COLUMN     "donorBankCode" TEXT,
ADD COLUMN     "donorAccountName" TEXT,
ADD COLUMN     "donorAccountNumberCiphertext" TEXT,
ADD COLUMN     "donorAccountNumberKeyId" TEXT;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
