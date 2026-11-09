-- CreateEnum
CREATE TYPE "MfaAuditAction" AS ENUM ('ENROLLED', 'RESET', 'BACKUP_CODES_REGENERATED', 'BACKUP_CODE_USED');

-- CreateTable
CREATE TABLE "UserMfa" (
    "userId" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "secretKeyId" TEXT NOT NULL,
    "enabledAt" TIMESTAMP(3),
    "lastUsedStep" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMfa_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "MfaBackupCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaBackupCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaAuditEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actedById" TEXT NOT NULL,
    "action" "MfaAuditAction" NOT NULL,
    "actedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "MfaAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MfaBackupCode_userId_idx" ON "MfaBackupCode"("userId");

-- CreateIndex
CREATE INDEX "MfaAuditEntry_userId_idx" ON "MfaAuditEntry"("userId");

-- AddForeignKey
ALTER TABLE "UserMfa" ADD CONSTRAINT "UserMfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaBackupCode" ADD CONSTRAINT "MfaBackupCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaAuditEntry" ADD CONSTRAINT "MfaAuditEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaAuditEntry" ADD CONSTRAINT "MfaAuditEntry_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
