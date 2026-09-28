-- Ticket 07/20 (CONTEXT.md, Admin): granting ADMIN takes two Admins, one
-- proposes and a DIFFERENT Admin confirms; granting VERIFIER stays a single
-- Admin's direct grant and does not use this table. Mirrors
-- BankAccountVerificationRequest (20260930030000) -- the same pending-request
-- shape and partial unique index, rather than a new design (ticket 07/20
-- answer).

-- AlterEnum: the audit trail now shows that a second Admin was asked, not
-- only the finished grant.
ALTER TYPE "AssignmentAuditAction" ADD VALUE 'PROPOSED';

-- AlterTable: an optional reason on every grant/revoke audit row, consistent
-- with CampaignStatusChange.reason (ticket 07/20 answer).
ALTER TABLE "AssignmentAuditEntry" ADD COLUMN "reason" TEXT;

-- CreateEnum
CREATE TYPE "GrantRequestOutcome" AS ENUM ('PENDING', 'CONFIRMED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "AssignmentGrantRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcome" "GrantRequestOutcome" NOT NULL DEFAULT 'PENDING',
    "proposedById" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposedReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedReason" TEXT,

    CONSTRAINT "AssignmentGrantRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the Admin queue, oldest PENDING first.
CREATE INDEX "AssignmentGrantRequest_outcome_proposedAt_idx" ON "AssignmentGrantRequest"("outcome", "proposedAt");

-- CreateIndex: one grantee's own history.
CREATE INDEX "AssignmentGrantRequest_userId_proposedAt_idx" ON "AssignmentGrantRequest"("userId", "proposedAt");

-- CreateIndex: at most one PENDING grant request per grantee (ticket 07/20
-- answer (a)). Partial, so it lives here and not in schema.prisma, like
-- "BankAccountVerificationRequest_bankAccountId_pending_key". Two proposals
-- racing past the service's check cannot both land PENDING.
CREATE UNIQUE INDEX "AssignmentGrantRequest_userId_pending_key" ON "AssignmentGrantRequest"("userId") WHERE "outcome" = 'PENDING';

-- AddForeignKey
ALTER TABLE "AssignmentGrantRequest" ADD CONSTRAINT "AssignmentGrantRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentGrantRequest" ADD CONSTRAINT "AssignmentGrantRequest_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentGrantRequest" ADD CONSTRAINT "AssignmentGrantRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
