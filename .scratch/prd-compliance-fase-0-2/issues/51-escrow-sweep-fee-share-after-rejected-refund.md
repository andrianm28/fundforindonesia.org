# 51: Porsi fee di rilis sweep escrow bisa meleset setelah Refund awal ditolak

**Status:** needs-triage

**Blocked by:** none

Ditemukan review PR #203 (opsional). Rilis sweep di `src/lib/money/escrow.ts`
(sekitar baris 446-463) menghitung ulang porsi fee dengan Refund terdahulu yang
bukan REJECTED. Setelah sebuah Refund awal ditolak, porsi fee Refund berikutnya
bisa berbeda beberapa rupiah dari yang diposting saat freeze. Perilakunya sudah
ada sebelum #203, tetapi baru bisa tercapai sejak Refund bisa ditolak.

- [ ] Tes yang memperlihatkan selisihnya (tolak Refund pertama, buat Refund
      kedua, jalankan sweep)
- [ ] Rilis memakai porsi fee dari entri yang sudah diposting, bukan hitung ulang

## Comments
