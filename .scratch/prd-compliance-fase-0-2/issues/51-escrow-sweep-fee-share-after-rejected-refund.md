# 51: Porsi fee di rilis sweep escrow bisa meleset setelah Refund awal ditolak

**Status:** awaiting-merge

**Blocked by:** none

Ditemukan review PR #203 (opsional). Rilis sweep di `src/lib/money/escrow.ts`
(sekitar baris 446-463) menghitung ulang porsi fee dengan Refund terdahulu yang
bukan REJECTED. Setelah sebuah Refund awal ditolak, porsi fee Refund berikutnya
bisa berbeda beberapa rupiah dari yang diposting saat freeze. Perilakunya sudah
ada sebelum #203, tetapi baru bisa tercapai sejak Refund bisa ditolak.

- [x] Tes yang memperlihatkan selisihnya (tolak Refund pertama, buat Refund
      kedua, jalankan sweep). Urutan yang benar-benar menimbulkan selisih
      ternyata lain: Refund kedua dibuat selagi yang pertama masih terbuka, lalu
      yang pertama ditolak (lihat Comments)
- [x] Rilis memakai porsi fee dari entri yang sudah diposting, bukan hitung ulang

## Comments

- 2026-10-03: owner menyetujui pengerjaan tiket ini (disampaikan koordinator
  lewat brief builder).
- 2026-10-03, branch `claude/prd-51-sweep-fee-share` (dari `origin/main`
  3f8cb9a): selisih terbukti, tetapi bukan dengan urutan di butir pertama. Pada
  3f8cb9a, menolak Refund pertama LALU membuat Refund kedua tidak menyisakan
  selisih: `createRefund` sudah mengecualikan Refund REJECTED dari himpunan Refund
  terdahulu saat membagi fee, jadi freeze dan hitung ulang sweep memakai himpunan
  yang sama (dicoba di Postgres sungguhan lalu dibuang, hasilnya `ESCROW_HOLD`
  tepat nol). Selisih muncul bila Refund kedua dibekukan selagi yang pertama
  masih terbuka, sehingga batas fee kumulatif memotong porsinya, lalu yang
  pertama ditolak. `releaseMaturedEscrow` lalu menghitung ulang porsi itu dari
  Refund yang masih berdiri, mendapat porsi lebih besar, dan melepas lebih dari
  yang dipegang `ESCROW_HOLD`. Selisihnya hanya bisa searah (rilis berlebih):
  membuang sebuah Refund dari himpunan terdahulu tidak pernah menurunkan porsi
  fee hasil hitung ulang. Contoh di tes: Payment Gross 100_000, Provider Fee
  3_333, Platform Fee 1_667, dua Refund 50_000. Freeze Refund kedua mendebit
  `ESCROW_HOLD` 47_501 (porsi 833 dan 1_666); sweep melepas 47_501 padahal yang
  tersisa 47_499, jadi `ESCROW_HOLD` berakhir di -2.
- 2026-10-03, perbaikan: sweep tidak lagi menghitung ulang. `escrowTakenByRefunds`
  di `escrow.ts` membaca debit `ESCROW_HOLD` dari jurnal freeze
  (`refund-requested-<id>`) tiap Refund yang masih berdiri (bukan REJECTED atau
  FAILED), dan rilis = Net Payment dikurangi jumlah itu; pola yang sama dengan
  `escrowShare` di `resolveRefund`. Debit itu adalah jumlah Refund dikurangi porsi
  Platform Fee dan Provider Fee yang diposting freeze, jadi yang dipakai memang
  porsi fee dari entri yang sudah diposting. Dua keputusan implementasi: (1)
  Refund yang masih berdiri tanpa jurnal freeze membuat rilis Payment itu ditolak
  (Payment tidak di-klaim, tetap memenuhi syarat, galat dicatat oleh catch
  per-payment di sweep), bukan dianggap tidak mengambil apa pun, karena yang
  terakhir akan melepas bagian Refund itu dan menutup Payment untuk selamanya;
  (2) `refundFreezeTransactionId` di `ledger.ts` menjadi satu-satunya ejaan
  transactionId freeze, dipakai `createRefund`, `resolveRefund`, dan sweep.
- 2026-10-03, tes: Postgres sungguhan
  `src/__tests__/integration/escrow-sweep-refund-fee-share-real-db.test.ts`
  (merah di 3f8cb9a dengan `ESCROW_HOLD` -2, hijau setelah perbaikan) dan dua tes
  unit baru di `src/lib/money/escrow.test.ts` (selisih yang sama tanpa DB; jurnal
  freeze yang hilang ditolak). Fixture Refund di tes unit kini membawa `id` dan
  jurnal freeze seperti di produksi; tes cap Payment saudara kini juga menegaskan
  `releasedCount`, karena sebelumnya bisa hijau walau sweep gagal pada Payment itu.
  Diulang dengan `npx vitest run src/lib/money` dan, dengan `TEST_DATABASE_URL`,
  `npx vitest run src/__tests__/integration/escrow-sweep-refund-fee-share-real-db.test.ts
  src/__tests__/integration/refund-reject-fail-real-db.test.ts
  src/__tests__/integration/escrow-sweep-rotation.test.ts`; `node ci/ratchet.mjs`
  tetap lint 193 dan tsc 19. Full suite dijalankan koordinator/CI, bukan builder.
- 2026-10-03, temuan terkait, tidak diubah di tiket ini: `approveRefund` di
  `refunds.ts` menghitung ulang porsi fee yang sama dengan himpunan Refund
  terdahulu yang berlaku saat approve, bukan membaca jurnal freeze. Akibatnya
  hanya `shortfall` (bila pool negatif) yang bisa meleset beberapa rupiah setelah
  Refund terdahulu ditolak di antara freeze dan approve.
