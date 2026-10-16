-- Contract step of retire-role-hierarchy (ticket 03, rilis-1 62): User "role",
-- "isVerified" and "verificationType" were made nullable and stopped being
-- read or written by 20260926150000 and its code, which is live in production
-- (commit 53fe2d2). Authority comes only from UserAssignment (ADR 0005). The
-- enum has no other user, so it goes with the column.

-- AlterTable
ALTER TABLE "User" DROP COLUMN "role",
DROP COLUMN "isVerified",
DROP COLUMN "verificationType";

-- DropEnum
DROP TYPE "Role";
