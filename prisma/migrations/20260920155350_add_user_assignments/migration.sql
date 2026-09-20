-- CreateEnum
CREATE TYPE "Assignment" AS ENUM ('VERIFIER', 'ADMIN');

-- CreateTable
CREATE TABLE "UserAssignment" (
    "userId" TEXT NOT NULL,
    "assignment" "Assignment" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAssignment_pkey" PRIMARY KEY ("userId","assignment")
);

-- CreateIndex
CREATE INDEX "UserAssignment_assignment_idx" ON "UserAssignment"("assignment");

-- AddForeignKey
ALTER TABLE "UserAssignment" ADD CONSTRAINT "UserAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
