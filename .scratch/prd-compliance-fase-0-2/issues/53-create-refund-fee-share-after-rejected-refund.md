# 53: createRefund menghitung ulang porsi fee sehingga fee terakui kurang setelah Refund ditolak

**Status:** awaiting-merge

**Blocked by:** 51 (done)

Ditemukan re-review PR #205; owner menyetujui pengerjaan 2026-10-03. Akar yang
sama dengan tiket 51: porsi fee dihitung ulang dari jumlah Refund yang masih
berdiri, bukan dibaca dari jurnal yang sudah diposting. Sejak Refund bisa
ditolak (tiket 49, PR #203), himpunan "Refund sebelumnya" bisa menyusut, dan
pembagian kumulatif di `createRefund` (`src/lib/money/refunds.ts`, sekitar
baris 286-307, memakai `platformFeePortionFor`/`providerFeePortionFor` di
`src/lib/money/ledger.ts`) tidak lagi menjumlah ke fee yang seharusnya.

Contoh dari re-review: R1 dan R2 terbuka, R1 ditolak, lalu R3 dibuat. Fee
terakui 3332 dari 3333 (Provider Fee) dan 1666 dari 1667 (Platform Fee), dan
`ESCROW_HOLD` sementara bernilai -2. Model simulasi reviewer ada di
scratchpad sesi koordinator (`pr205/sim/sim2.ts`), bukan di repo.

- [x] Tes merah dulu (unit dan satu tes Postgres sungguhan) untuk urutan di atas,
      termasuk Refund penuh setelah penolakan: total fee terakui atas Refund yang
      berdiri sama persis dengan porsi kumulatifnya, dan `ESCROW_HOLD` tidak
      pernah negatif
- [x] Porsi fee Refund baru dihitung dari fee yang sudah diposting oleh jurnal
      freeze Refund yang masih berdiri (helper `refundFreezeDebit` dari #205),
      bukan dari daftar jumlah. Daftar jumlah masih dipakai satu hal: menentukan
      porsi kumulatif yang dituju (lihat Comments, keputusan 2)
- [x] Tes yang membunuh mutan "approve mengabaikan PLATFORM_FEE atau
      REFUND_COST": pool terkuras, R1 dan R2 terbuka, R1 di-approve lebih dulu
      (shortfall 47.499), saldo ditegaskan persis
- [x] Perilaku tanpa penolakan tidak berubah (tes yang ada tetap hijau)

## Comments

- 2026-10-03, branch `claude/prd-53-create-refund-fee-share` (dari `17a401f`, yang
  memuat #205): direproduksi di `17a401f` di Postgres sungguhan dan di fake. Payment
  100_000 (Provider Fee 3_333, Platform Fee 1_667), R1 dan R2 50_000 terbuka, R1
  ditolak, R3 50_000: R3 mendapat 833 dan 1_666 (seharusnya 834 dan 1_667), Refund
  yang berdiri membawa 1_666 dari 1_667 dan 3_332 dari 3_333, `ESCROW_HOLD` -2.
  Tes merah di `17a401f`, hijau di commit kerja `df30ada` (sha penuh
  `df30ada2d0744773682607817910bcc48c92a317`). PR belum dibuat; koordinator
  menambahkan nomornya di sini.
- 2026-10-03, keputusan implementasi:
  1. `createRefund` membaca fee yang sudah diposting tiap Refund yang masih
     berdiri (bukan REJECTED atau FAILED) dari jurnal freeze-nya lewat
     `refundFreezeDebit`, lewat fungsi baru `standingRefundFees` di `refunds.ts`.
     Tanpa Refund yang berdiri tidak ada bacaan tambahan.
  2. Mengurangi fee dengan yang sudah diposting saja (`min(porsi sendiri, fee -
     diposting)`) ternyata TIDAK cukup. Pada model reviewer #205 (scratchpad
     koordinator, bukan di repo) varian itu masih melanggar pada 16 dan 7 dari
     masing-masing 40.000 walk acak, termasuk `ESCROW_HOLD` negatif; urutan
     terpendeknya: 50_000, 25_000, 25_000 terbuka, dua yang pertama ditolak, lalu
     75_000, yang mendapat Provider Fee 2_500 dari seharusnya 2_501 karena porsi
     Refund 25_000 yang berdiri pernah dipotong dua Refund yang kini ditolak.
     Maka porsi = porsi kumulatif (jumlah porsi bulat-ke-atas tiap Refund yang
     berdiri ditambah milik sendiri, dibatasi fee; sama seperti sebelum tiket ini)
     dikurangi yang sudah diposting, dibatasi jumlah Refund itu sendiri. Dengan
     itu total fee atas Refund yang berdiri selalu sama dengan porsi kumulatif, dan
     Refund yang menutup Payment menyusul porsi yang pernah terpotong. Tanpa
     penolakan hasilnya identik dengan perilaku lama (deret 50_000, 40_000, 10_000
     dikunci tes; varian "satu pembulatan atas jumlah total" merahkan tes itu).
  3. Refund yang berdiri tanpa jurnal freeze membuat `createRefund` menolak tanpa
     menulis apa pun (`Error` biasa, seperti sweep escrow), bukan dianggap
     mengambil nol. Tidak mungkin terjadi pada operasi normal: `createRefund`
     memposting jurnal di transaksi yang sama dengan barisnya.
  4. `platformFeePortionFor` dan `providerFeePortionFor` di `ledger.ts`: argumen
     ketiga kini `StandingRefundFees[]` (jumlah dan fee yang diposting), bukan
     `number[]`. Pemanggil produksinya hanya `createRefund` (sweep escrow sudah tidak
     memanggilnya sejak #205); pemanggil lain hanya fixture `journal()` di
     `refunds.test.ts`, yang memanggil dengan daftar kosong (Refund pertama) dan
     tetap benar tanpa diubah. Pemanggil basi yang masih mengirim daftar jumlah
     gagal di `tsc`, tidak diam-diam menghitung dengan cara lama.
  5. Batas yang disengaja: sebuah Refund tidak membawa fee melebihi jumlahnya
     sendiri; bila ada porsi yang belum terambil dari Refund sekecil itu, sisanya
     menunggu Refund berikutnya. `refundRequestedLegs` tetap menolak porsi gabungan
     yang melebihi jumlah Refund (perilaku lama, Refund beberapa rupiah).
  6. Catatan data lama: Refund yang dibekukan sebelum prd-compliance 17 (jurnal
     freeze tanpa leg `PLATFORM_FEE`) kini dianggap membawa Platform Fee 0, jadi
     Refund berikutnya pada Payment itu menyusul porsinya. Itu yang dicatat buku
     besar. Tidak diperiksa terhadap data produksi (di luar jangkauan sesi cloud);
     bila ada Refund semacam itu di produksi, perilakunya berubah seperti ini.
- 2026-10-03, tes: `refunds.test.ts` (urutan R1, R2, R3 lewat `createRefund` dan
  `rejectRefund`, Refund digagalkan setelah approve, catch-up, deret tanpa
  penolakan, jurnal hilang, pembunuh mutan approve), `ledger.test.ts` (porsi murni
  dan satu tes properti `fast-check`), dan di
  `escrow-sweep-refund-fee-share-real-db.test.ts` satu `describe` bersarang
  (Campaign, Refund digagalkan, catch-up, Volunteer Trip, pembunuh mutan approve).
  Fake `makeTx`/`makeMultiPaymentTx` kini mengembalikan `id` Refund dan fixture
  Refund terdahulu membawa jurnal freeze seperti di produksi.
  Pembunuh mutan approve: pool terkuras, R1 dan R2 terbuka, R1 di-approve lebih
  dulu, shortfall 47_499 dan saldo -47_501 sesudahnya, lalu 0 setelah R2. Mutan
  (kalikan 0 pada bacaan `refundFreezeDebit` untuk `'PLATFORM_FEE'`, atau untuk
  `'REFUND_COST'`, di `approveRefund`): hanya dua tes itu yang merah di 1201 tes
  `src/lib/money`, `src/app/api/campaigns`, `src/app/api/volunteer-trips`, dan dua
  berkas real-DB refund.
  Diulang (Postgres lokal, `TEST_DATABASE_URL=postgresql://ci:ci@localhost:5432/ci?schema=public`):
  `npx vitest run src/lib/money`; `npx vitest run
  src/__tests__/integration/escrow-sweep-refund-fee-share-real-db.test.ts
  src/__tests__/integration/refund-reject-fail-real-db.test.ts`; juga semua berkas
  tes yang menyentuh modul Refund (99 berkas, 1876 tes lulus); `node ci/ratchet.mjs`:
  lint 193 dan tsc 19, tak berubah. Full suite dijalankan koordinator/CI, bukan builder.
  Di luar repo, hanya sebagai pemeriksaan: model reviewer #205 dengan rumus ini
  (400.000 walk acak) tidak melanggar satu pun invarian (varian "kurangi dengan yang
  diposting saja" dan hitung ulang lama melanggar), dan 840 skrip acak model itu
  diputar ulang di `createRefund`, `approveRefund`, `rejectRefund`, `failRefund` dan
  sweep di Postgres sungguhan: tiap shortfall dan saldo `FROZEN_BALANCE`,
  `ESCROW_HOLD`, pool, `PLATFORM_FEE`, `REFUND_COST` cocok dengan model.
- Tidak disentuh: `src/app/api/admin/reconcile/route.ts` (tiket 52), `escrow.ts`,
  `approveRefund`, `resolveRefund`.
