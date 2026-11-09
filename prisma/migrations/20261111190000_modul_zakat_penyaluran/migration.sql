-- Modul zakat di balik penanda fitur (PKS pemenuhan 19, Pasal 3.5 dan 12(2); ADR 0028).
--
-- ZakatDistribution: catatan bahwa lembaga penerima zakat menyalurkan zakat
-- kepada mustahik, diisi Admin. HANYA CATATAN: tidak memposting LedgerEntry dan
-- tidak memindahkan uang. Tabel baru dan kosong, jadi tidak ada baris lama yang
-- perlu diisi ulang dan tidak ada tabel yang sudah berisi yang dikunci.

-- CreateEnum
CREATE TYPE "ZakatAsnaf" AS ENUM ('FAKIR', 'MISKIN', 'AMIL', 'MUALAF', 'RIQAB', 'GHARIM', 'FISABILILLAH', 'IBNU_SABIL');

-- CreateTable
CREATE TABLE "ZakatDistribution" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "asnaf" "ZakatAsnaf" NOT NULL,
    "distributedAt" TIMESTAMP(3) NOT NULL,
    "recipientSummary" VARCHAR(300) NOT NULL,
    "note" VARCHAR(500),
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZakatDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZakatDistribution_organisationId_distributedAt_idx" ON "ZakatDistribution"("organisationId", "distributedAt");

-- AddForeignKey
ALTER TABLE "ZakatDistribution" ADD CONSTRAINT "ZakatDistribution_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "PartnerOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZakatDistribution" ADD CONSTRAINT "ZakatDistribution_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
