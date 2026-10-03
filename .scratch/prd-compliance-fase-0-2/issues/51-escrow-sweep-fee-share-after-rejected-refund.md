# 51: Porsi fee di rilis sweep escrow dan di approve Refund bisa meleset setelah Refund awal ditolak

**Status:** awaiting-merge

**Blocked by:** none

Ditemukan review PR #203 (opsional). Rilis sweep di `src/lib/money/escrow.ts`
(`releaseMaturedEscrow`) menghitung ulang porsi fee dengan Refund terdahulu yang
bukan REJECTED. Setelah sebuah Refund awal ditolak, porsi fee Refund berikutnya
bisa berbeda beberapa rupiah dari yang diposting saat freeze. Perilakunya sudah
ada sebelum #203, tetapi baru bisa tercapai sejak Refund bisa ditolak.

Cakupan diperluas 2026-10-03 atas temuan blocking review independen PR #205:
`approveRefund` di `src/lib/money/refunds.ts` punya akar yang sama. Ia menghitung
ulang `netPortion` dari himpunan Refund terdahulu yang berlaku saat approve, jadi
`shortfall` pada pool Campaign yang sudah dikuras Payout bisa terpotong beberapa
rupiah. Dikerjakan di tiket dan PR yang sama (lihat Comments).

- [x] Tes yang memperlihatkan selisihnya (tolak Refund pertama, buat Refund
      kedua, jalankan sweep). Urutan yang benar-benar menimbulkan selisih
      ternyata lain: Refund kedua dibuat selagi yang pertama masih terbuka, lalu
      yang pertama ditolak (lihat Comments)
- [x] Rilis memakai porsi fee dari entri yang sudah diposting, bukan hitung ulang
- [x] Tes Postgres sungguhan untuk `approveRefund`: Refund setelah Payout, Refund
      kedua dibuat selagi yang pertama masih terbuka, yang pertama ditolak (atau
      digagalkan setelah approve), lalu yang kedua di-approve. `CAMPAIGN_BALANCE`
      kembali tepat 0 dan `REFUND_COST` tepat 49_167; merah di `e59f47c`
- [x] `approveRefund` memakai porsi fee dari jurnal freeze Refund itu sendiri
      (`netPortion` = jumlah Refund dikurangi debit `PLATFORM_FEE` dan
      `REFUND_COST` di jurnal freeze), bukan hitung ulang
- [x] Filter+reduce kembar atas debit jurnal freeze (`resolveRefund` dan
      `escrowTakenByRefunds`) menjadi satu helper, `refundFreezeDebit` di
      `src/lib/money/ledger.ts`, yang juga dipakai approve

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
- 2026-10-03, cakupan diperluas ke `approveRefund` (permintaan koordinator atas
  temuan blocking review independen PR #205, yang menyatakan sweep sudah benar;
  menggantikan "tidak diubah di tiket ini" di komentar sebelumnya). PR #205,
  branch `claude/prd-51-sweep-fee-share`: sweep di commit `e59f47c`, approve di
  commit `3ef3e83`.

  Pemicu: pool Campaign negatif (Refund setelah Payout), Refund kedua dibuat
  selagi Refund pertama masih terbuka, Refund pertama ditolak (atau digagalkan
  setelah approve), lalu Refund kedua di-approve. Payment 100_000 (Provider Fee
  3_333, Platform Fee 1_667), dua Refund 50_000: freeze Refund kedua mengambil
  47_501 (porsi 833 dan 1_666), tetapi di `e59f47c` approve menghitung ulang porsi
  834 dan 1_667 (himpunan Refund terdahulunya kini kosong), mendapat `netPortion`
  47_499, dan mencatat shortfall 47_499. Hasilnya `CAMPAIGN_BALANCE` tersisa -2
  dan `REFUND_COST` 49_165, seharusnya 0 dan 49_167. Selisihnya searah (shortfall
  terpotong), karena membuang sebuah Refund dari himpunan terdahulu tidak pernah
  memperkecil porsi fee hasil hitung ulang, dan hanya muncul bila pool negatif.

  Perbaikan: `approveRefund` membaca debit `PLATFORM_FEE` dan `REFUND_COST` (porsi
  Provider Fee) dari jurnal freeze Refund itu sendiri (`refund-requested-<id>`),
  dan `netPortion` adalah sisa jumlah Refund; pola yang sama dengan sweep. Porsi
  fee dibaca dari leg fee, bukan dari leg pool, karena leg pool ada di akun yang
  jadi sumber saat freeze sedangkan leg fee ada di akun bernama tetap. Filter dan
  reduce kembar atas debit freeze di `resolveRefund` dan `escrowTakenByRefunds`
  diekstrak, bersama bacaan approve, menjadi satu helper, `refundFreezeDebit` di
  `ledger.ts`. Keputusan implementasi: Refund REQUESTED tanpa jurnal freeze
  ditolak approve (`InvalidRefundStatusError`, rincian `its freeze journal is
  missing`) sebelum klaim atas barisnya, selaras dengan sweep dan `resolveRefund`,
  bukan dianggap mengambil nol.

  Tes: Postgres sungguhan di `escrow-sweep-refund-fee-share-real-db.test.ts`
  (berkas yang sama dengan tes sweep, judulnya diperluas): Refund pertama ditolak
  dan, varian kedua, digagalkan setelah approve; menegaskan `CAMPAIGN_BALANCE` 0
  dan `REFUND_COST` 49_167 serta jurnal approve (shortfall 47_501). Merah di
  `e59f47c` (-2, 49_165, 47_499). Tes sweep tambahan untuk Refund FAILED dan
  Payment Volunteer Trip (real-DB dan unit; merah bila `escrow.ts` dikembalikan
  ke versi `3f8cb9a`); unit approve membaca freeze dan menolak tanpa jurnal
  freeze; unit `refundFreezeDebit`. Fixture approve di `refunds.test.ts` dan di
  dua `route.test.ts` approve kini membawa jurnal freeze seperti di produksi.

  Diulang (Postgres lokal, `TEST_DATABASE_URL=postgresql://ci:ci@localhost:5432/ci?schema=public`):
  `npx vitest run src/__tests__/integration/escrow-sweep-refund-fee-share-real-db.test.ts
  src/__tests__/integration/refund-reject-fail-real-db.test.ts
  src/__tests__/integration/escrow-sweep-rotation.test.ts`; `npx vitest run`
  penuh: 411 berkas lulus, 5386 tes lulus, 8 dilewati; `node ci/ratchet.mjs`:
  lint 193 dan tsc 19, tak berubah. Tidak disentuh:
  `src/app/api/admin/reconcile/route.ts` (tiket terpisah).
