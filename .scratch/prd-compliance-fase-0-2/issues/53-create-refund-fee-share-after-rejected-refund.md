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
      pernah negatif. Dikoreksi atas review #208: "sama persis" hanya berlaku
      sampai ada penolakan; sesudahnya total itu tidak kurang dari porsi kumulatif
      dan tidak lebih dari fee (lihat Comments)
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
  `df30ada2d0744773682607817910bcc48c92a317`).
  PR #208. Commit di branch: `df30ada` (perbaikan awal, kode dan tes), `fb0ec99`
  (tiket `awaiting-merge`), `f2e5fca` (perbaikan atas review independen #208, sha
  penuh `f2e5fca75d00e1ce3da48d09229a2ab9d07a5646`), lalu satu commit tiket yang
  mengoreksi komentar ini.
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
     itu, begitu sebuah Refund dibuat, total fee atas Refund yang berdiri tidak
     kurang dari porsi kumulatif dan tidak lebih dari fee (jadi pool tidak pernah
     terdebit melebihi isinya), dan Refund yang menutup Payment menyusul porsi yang
     pernah terpotong (total = fee). Total itu sama persis dengan porsi kumulatif
     hanya selama belum ada penolakan; sesudahnya bisa satu-dua rupiah di atasnya
     (koreksi atas klaim awal "selalu sama persis", lihat komentar review #208).
     Tanpa penolakan hasilnya identik dengan perilaku lama (deret 50_000, 40_000,
     10_000 dikunci tes; varian "satu pembulatan atas jumlah total" merahkan tes
     itu).
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
  6. Refund pra-prd-17 (jurnal freeze tanpa leg `PLATFORM_FEE`) tidak mungkin ada
     pada Payment yang membawa Platform Fee: kolom `Payment.platformFee` NOT NULL
     DEFAULT 0 (migrasi `20260927030000_add_platform_fee`, tanpa backfill), jadi
     Payment lama membawa Platform Fee 0 dan porsi 0 pada jurnal freeze Refund-nya
     memang benar. Tidak ada Refund lama yang kini "menyusul" porsi (koreksi atas
     catatan awal di sini).
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
- 2026-10-03, review independen PR #208. Algoritmanya dinyatakan benar (200.000
  walk acak tanpa pelanggaran, 1.400 skrip Postgres cocok dengan model, hasil
  tanpa penolakan identik dengan `main`). Dua temuan blocking, diperbaiki di
  `f2e5fca`:
  1. Tes properti di `ledger.test.ts` menegaskan `toBe(porsi kumulatif)` setelah
     tiap Refund dibuat, padahal itu bukan invarian. Sesudah penolakan, fee yang
     sudah diposting bisa melebihi porsi kumulatif: porsi yang diambil sebuah
     Refund untuk menutup potongan pada Refund lain tetap terposting bila Refund
     yang ditutupi kemudian ditolak (buku besar tidak disunting), sehingga Refund
     berikutnya mendapat 0, bukan negatif, dan totalnya satu-dua rupiah di atas
     porsi kumulatif. Contoh review: Payment 10_000 dengan Provider Fee 10, Refund
     1_010, 100 dan 8_001; dua yang pertama ditolak; Refund 100 (porsi 3); yang
     8_001 ditolak; Refund 100 (porsi 0). Total 3, porsi kumulatif 2. Tes itu flaky
     sekitar 1%. Dengan contoh itu dipasang sebagai `examples`, tes lama merah
     deterministik di `fb0ec99` ("expected 3 to be 2"). Perbaikan: asersi menjadi
     total >= porsi kumulatif dan <= fee (sama persis hanya selama belum ada
     penolakan), ditambah porsi tiap Refund tidak negatif dan tidak melebihi
     jumlahnya; contoh review juga menjadi tes deterministik, pada fungsi porsi
     (`ledger.test.ts`) dan lewat `createRefund` dan `rejectRefund`
     (`refunds.test.ts`: Refund kelima membeku tanpa leg fee, pool 9_793). Klaim di
     item 2 dikoreksi. Algoritma tidak berubah; di `ledger.ts` hanya komentar
     `feePortionOf` yang diperjelas.
  2. Status `awaiting-merge` kini menyebut PR #208 dan commit (komentar pertama).
  Sekalian: item 6 dikoreksi (Payment lama membawa Platform Fee 0, jadi tidak ada
  Refund pra-prd-17 yang terpengaruh). Dua mutan yang lolos semua 1.201 tes
  terkait di `fb0ec99` kini merah: (a) hapus `Math.max(0, ...)` di `feePortionOf`
  (3 tes: dua contoh deterministik dan tes properti); (b) hapus pagar
  `combinedFeePortion > amount` di `refundRequestedLegs`, yaitu porsi fee gabungan
  yang lebih besar dari jumlah Refund (2 tes baru: `ledger.test.ts` pada
  `refundRequestedLegs`, dan `refunds.test.ts` lewat `createRefund` pada Refund 1
  rupiah di Payment dengan dua fee, yang harus ditolak sebagai
  `InvalidLedgerLegError` tanpa memposting apa pun). Pagar jumlah per fee
  (`Math.min(..., targetAmount)` di `feePortionOf`) juga dicoba: sudah merah di
  satu tes dari `df30ada`, jadi bukan yang lolos. Enam mutan lain pada aritmetika
  porsi (hanya fee terposting Refund terakhir yang dihitung, porsi sendiri
  dibuang, batas fee dan batas jumlah masing-masing bergeser satu, pagar gabungan
  memakai `>=`, porsi Refund yang berdiri memakai jumlah milik sendiri) semuanya
  merah. Tidak diubah, dicatat sebagai tiket lanjutan menurut review: helper
  "jurnal hilang" (`Error` biasa di `standingRefundFees`) dan kode error domain.
  Diulang (`TEST_DATABASE_URL=postgresql://ci:ci@localhost:5432/ci?schema=public`):
  `npx vitest run src/lib/money`; `npx vitest run
  src/__tests__/integration/escrow-sweep-refund-fee-share-real-db.test.ts
  src/__tests__/integration/refund-reject-fail-real-db.test.ts`; semua berkas tes
  yang menyentuh modul Refund (99 berkas, 1880 tes lulus); tes properti
  (`npx vitest run src/lib/money/ledger.test.ts -t "property: Refunds standing"`)
  60 kali, tiap kali proses vitest sendiri dengan seed acak berbeda: 60 lulus; 300
  seed eksplisit dengan 2.000 kasus tiap seed (salinan sementara blok tes itu,
  tidak ada di repo): lulus; full suite sekali (`npx vitest run`, dengan
  `TEST_DATABASE_URL` dan `LEDGER_CLAIM_TEST_DATABASE_URL` ke Postgres lokal): 412
  berkas, 5453 tes lulus, tidak ada yang dilewati; `node ci/ratchet.mjs`:
  lint 193 dan tsc 19, tak berubah.
- Tidak disentuh: `src/app/api/admin/reconcile/route.ts` (tiket 52), `escrow.ts`,
  `approveRefund`, `resolveRefund`.
