-- Failed notification queue, webhook "tandai selesai", and the Admin alert
-- throttle (PKS pemenuhan 05; Pasal 8(2)). Additive only: one enum, one column
-- group on WebhookEvent (all nullable), two new tables. No backfill, no UPDATE.
--
-- Rollback (by hand, if ever needed): DROP TABLE "AdminAlertThrottle",
-- "FailedNotification"; ALTER TABLE "WebhookEvent" DROP COLUMN for the three new
-- columns (the FK and index go with them); DROP TYPE "FailedNotificationStatus".

-- CreateEnum
CREATE TYPE "FailedNotificationStatus" AS ENUM ('PENDING', 'SENT', 'DEAD');

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "resolutionNote" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedById" TEXT;

-- CreateTable
CREATE TABLE "FailedNotification" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "recipientHmac" TEXT NOT NULL,
    "recipientKeyId" TEXT NOT NULL,
    "payloadCiphertext" TEXT,
    "payloadKeyId" TEXT,
    "status" "FailedNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "claimedUntil" TIMESTAMP(3),
    "claimToken" TEXT,
    "sentAt" TIMESTAMP(3),
    "lastRetriedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailedNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAlertThrottle" (
    "kind" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAlertThrottle_pkey" PRIMARY KEY ("kind")
);

-- CreateIndex
CREATE INDEX "FailedNotification_status_nextAttemptAt_idx" ON "FailedNotification"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "FailedNotification_createdAt_idx" ON "FailedNotification"("createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_resolvedAt_idx" ON "WebhookEvent"("resolvedAt");

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailedNotification" ADD CONSTRAINT "FailedNotification_lastRetriedById_fkey" FOREIGN KEY ("lastRetriedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
