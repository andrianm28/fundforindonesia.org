-- Aamiin anti-ganda dan kurasi beranda (PKS pemenuhan 15, pasal 3.7(5)-(6)).
--
-- AamiinMark: satu baris per (doa, penanda); penanda "u:<userId>" atau
-- "a:<idAnonim>" dari cookie bertanda tangan. Prayer.amiinCount naik hanya
-- bila baris baru masuk. Doa lama tidak punya baris: hitungannya tetap.
-- CampaignFeature / PrayerHighlight: penandaan Admin untuk beranda (urutan
-- manual, siapa dan kapan). Kolom "markedById" teks biasa, bukan FK: catatan
-- siapa yang menandai harus bertahan setelah akunnya hilang.

-- CreateEnum
CREATE TYPE "CampaignFeatureKind" AS ENUM ('PILIHAN', 'UNGGULAN_KATEGORI');

-- CreateTable
CREATE TABLE "AamiinMark" (
    "id" TEXT NOT NULL,
    "prayerId" TEXT NOT NULL,
    "marker" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AamiinMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignFeature" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" "CampaignFeatureKind" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "markedById" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrayerHighlight" (
    "id" TEXT NOT NULL,
    "prayerId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "markedById" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrayerHighlight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AamiinMark_prayerId_marker_key" ON "AamiinMark"("prayerId", "marker");

-- CreateIndex
CREATE INDEX "CampaignFeature_kind_position_idx" ON "CampaignFeature"("kind", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignFeature_campaignId_kind_key" ON "CampaignFeature"("campaignId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PrayerHighlight_prayerId_key" ON "PrayerHighlight"("prayerId");

-- CreateIndex
CREATE INDEX "PrayerHighlight_position_idx" ON "PrayerHighlight"("position");

-- AddForeignKey
ALTER TABLE "AamiinMark" ADD CONSTRAINT "AamiinMark_prayerId_fkey" FOREIGN KEY ("prayerId") REFERENCES "Prayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignFeature" ADD CONSTRAINT "CampaignFeature_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerHighlight" ADD CONSTRAINT "PrayerHighlight_prayerId_fkey" FOREIGN KEY ("prayerId") REFERENCES "Prayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

