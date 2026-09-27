-- Reminder-sent markers for the scheduled job (ticket 20): both are new and
-- have nothing to backfill, so every existing row starts NULL, same as any
-- Campaign or KindAuthorisation that predates this column.

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "deadlineReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "KindAuthorisation" ADD COLUMN "expiryWarningSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Campaign_lifecycleStatus_deadline_idx" ON "Campaign"("lifecycleStatus", "deadline");

-- CreateIndex
CREATE INDEX "KindAuthorisation_validTo_expiryWarningSentAt_idx" ON "KindAuthorisation"("validTo", "expiryWarningSentAt");
