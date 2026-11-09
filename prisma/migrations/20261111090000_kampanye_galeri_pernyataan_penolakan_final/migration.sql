-- Kampanye: galeri, pernyataan kebenaran data, penolakan final (PKS pemenuhan 09,
-- pasal 3.3-3.4). Hanya menambah kolom dengan default atau nullable, jadi aman
-- pada tabel yang sudah berisi.
--
-- 1. Campaign.galleryImages: paling banyak enam gambar tambahan di samping
--    sampul. Batas enam dijaga aplikasi dan CHECK ini.
-- 2. Campaign.rejectionFinal dan CampaignStatusChange.final: Verifier menolak
--    untuk selamanya; Campaign semacam itu tidak bisa diajukan ulang.
-- 3. VerificationRequest.truthStatementAcceptedAt: kapan Fundraiser mencentang
--    pernyataan kebenaran data saat mengajukan. Pengajuan lama tidak punya.

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "galleryImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rejectionFinal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CampaignStatusChange" ADD COLUMN     "final" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "VerificationRequest" ADD COLUMN     "truthStatementAcceptedAt" TIMESTAMP(3);

-- Paling banyak enam gambar galeri per Campaign.
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_galleryImages_max6" CHECK (cardinality("galleryImages") <= 6);
