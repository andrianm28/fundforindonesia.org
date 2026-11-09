-- Jejak moderasi doa (tindak lanjut review tiket 10, PKS pasal 3.7c).
--
-- Menampilkan lagi doa yang disembunyikan mengosongkan hiddenAt/hiddenById,
-- sehingga siapa yang menyembunyikannya hilang. Dua kolom ini menyimpan
-- moderasi TERAKHIR (sembunyikan, tampilkan, atau hapus): siapa dan kapan.
-- Teks tanpa FK, sama seperti hiddenById/deletedById, agar catatan bertahan
-- setelah akun dihapus. Doa lama tetap NULL (belum pernah dimoderasi).

-- AlterTable
ALTER TABLE "Prayer" ADD COLUMN     "lastModeratedAt" TIMESTAMP(3),
ADD COLUMN     "lastModeratedById" TEXT;
