-- CreateEnum
CREATE TYPE "AssignmentAuditAction" AS ENUM ('GRANTED', 'REVOKED');

-- CreateTable
CREATE TABLE "AssignmentAuditEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignment" "Assignment" NOT NULL,
    "action" "AssignmentAuditAction" NOT NULL,
    "actedById" TEXT NOT NULL,
    "actedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssignmentAuditEntry_userId_idx" ON "AssignmentAuditEntry"("userId");

-- CreateIndex
CREATE INDEX "AssignmentAuditEntry_assignment_idx" ON "AssignmentAuditEntry"("assignment");

-- AddForeignKey
ALTER TABLE "AssignmentAuditEntry" ADD CONSTRAINT "AssignmentAuditEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentAuditEntry" ADD CONSTRAINT "AssignmentAuditEntry_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
