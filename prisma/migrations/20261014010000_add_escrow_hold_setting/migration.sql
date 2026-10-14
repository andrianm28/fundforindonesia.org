-- Admin-set Escrow Hold length (ticket 90; PRD FFI-17; CONTEXT.md, Escrow
-- Hold). Additive: one enum and one append-only table. No backfill and no
-- seeded row -- with none set, the length resolves to the 7-day fallback in
-- src/lib/money/escrow.ts, so behaviour is unchanged until an Admin sets one.
-- Payment.escrowHoldDays is untouched: every existing Payment keeps the value
-- it already froze.

-- CreateEnum
CREATE TYPE "EscrowHoldScope" AS ENUM ('DEFAULT', 'CATEGORY');

-- CreateTable
CREATE TABLE "EscrowHoldSetting" (
    "id" TEXT NOT NULL,
    "scope" "EscrowHoldScope" NOT NULL,
    "category" TEXT,
    "days" INTEGER NOT NULL,
    "setById" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscrowHoldSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EscrowHoldSetting_scope_category_setAt_idx" ON "EscrowHoldSetting"("scope", "category", "setAt");

-- AddForeignKey
ALTER TABLE "EscrowHoldSetting" ADD CONSTRAINT "EscrowHoldSetting_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
