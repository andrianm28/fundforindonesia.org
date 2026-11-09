-- PKS Pasal 3.1, 3.8 (tiket 07): jenis profil Individu/Lembaga dan catatan
-- persetujuan Syarat Layanan + Kebijakan Privasi per pengguna (dokumen, versi,
-- waktu). Aditif: kolom baru ber-DEFAULT dan tabel baru; baris yang ada tidak
-- diubah. Nomor WhatsApp memakai kolom phoneCiphertext/phoneKeyId yang sudah ada.

-- CreateEnum
CREATE TYPE "ProfileType" AS ENUM ('INDIVIDUAL', 'ORGANISATION');

-- CreateEnum
CREATE TYPE "ConsentDocument" AS ENUM ('TERMS', 'PRIVACY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "profileType" "ProfileType" NOT NULL DEFAULT 'INDIVIDUAL';

-- CreateTable
CREATE TABLE "UserConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "document" "ConsentDocument" NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserConsent_userId_idx" ON "UserConsent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserConsent_userId_document_version_key" ON "UserConsent"("userId", "document", "version");

-- AddForeignKey
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
