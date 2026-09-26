-- Audit of Admin edits to the verification checklist (verification-request 04).
-- Additive: one append-only table and its action enum. Every change to a
-- VerificationChecklistItem records the actor, the time, and the item before
-- and after. Foreign keys RESTRICT: neither items nor audit rows are deleted.

-- CreateEnum
CREATE TYPE "VerificationChecklistAuditAction" AS ENUM ('CREATED', 'UPDATED');

-- CreateTable
CREATE TABLE "VerificationChecklistAuditEntry" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "action" "VerificationChecklistAuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "actedById" TEXT NOT NULL,
    "actedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationChecklistAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationChecklistAuditEntry_itemId_actedAt_idx" ON "VerificationChecklistAuditEntry"("itemId", "actedAt");

-- AddForeignKey
ALTER TABLE "VerificationChecklistAuditEntry" ADD CONSTRAINT "VerificationChecklistAuditEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "VerificationChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationChecklistAuditEntry" ADD CONSTRAINT "VerificationChecklistAuditEntry_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

