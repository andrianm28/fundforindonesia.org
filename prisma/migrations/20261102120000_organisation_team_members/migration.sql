-- CreateEnum
CREATE TYPE "OrganisationMemberRole" AS ENUM ('VIEWER');

-- CreateTable
CREATE TABLE "OrganisationMember" (
    "id" TEXT NOT NULL,
    "partnerOrganisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrganisationMemberRole" NOT NULL DEFAULT 'VIEWER',
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganisationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationInvitation" (
    "id" TEXT NOT NULL,
    "partnerOrganisationId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "emailHmac" TEXT NOT NULL,
    "emailHmacKeyId" TEXT NOT NULL,
    "emailCiphertext" TEXT NOT NULL,
    "emailKeyId" TEXT NOT NULL,
    "role" "OrganisationMemberRole" NOT NULL DEFAULT 'VIEWER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganisationInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationMember_userId_key" ON "OrganisationMember"("userId");

-- CreateIndex
CREATE INDEX "OrganisationMember_partnerOrganisationId_idx" ON "OrganisationMember"("partnerOrganisationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationInvitation_tokenHash_key" ON "OrganisationInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "OrganisationInvitation_partnerOrganisationId_createdAt_idx" ON "OrganisationInvitation"("partnerOrganisationId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrganisationMember" ADD CONSTRAINT "OrganisationMember_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES "PartnerOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationMember" ADD CONSTRAINT "OrganisationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationMember" ADD CONSTRAINT "OrganisationMember_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationInvitation" ADD CONSTRAINT "OrganisationInvitation_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES "PartnerOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationInvitation" ADD CONSTRAINT "OrganisationInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationInvitation" ADD CONSTRAINT "OrganisationInvitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

