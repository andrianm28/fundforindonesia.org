-- Ticket 52: a `paid` event for a Payment already EXPIRED/FAILED, and a charge
-- created at the provider with no Payment written, must both be findable.
-- Additive: one nullable column, one new table, no backfill.

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN "outcome" TEXT;

-- CreateTable
CREATE TABLE "ChargeWriteFailure" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,

    CONSTRAINT "ChargeWriteFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChargeWriteFailure_resolvedAt_createdAt_idx" ON "ChargeWriteFailure"("resolvedAt", "createdAt");

-- CreateIndex
CREATE INDEX "ChargeWriteFailure_providerRef_idx" ON "ChargeWriteFailure"("providerRef");

-- CreateIndex
CREATE INDEX "WebhookEvent_outcome_idx" ON "WebhookEvent"("outcome");
