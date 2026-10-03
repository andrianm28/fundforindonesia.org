# 52: Laporan reconcile menandai Payment dengan Refund REJECTED/FAILED sebagai strandedEscrow

**Status:** done (PR #207, 25c23f4)

**Blocked by:** none (49 done)

Ditemukan review PR #205 dan diverifikasi koordinator dengan membaca kode;
owner menyetujui pengerjaan 2026-10-03. Regresi dari tiket 49 (PR #203).

`src/app/api/admin/reconcile/route.ts` (sekitar baris 384-410) menghitung
`refundedAmount` sebuah Payment yang escrow-nya sudah dirilis dari semua debit
`ESCROW_HOLD` ber-`refundId` milik Refund terhadap Payment itu, tanpa melihat
status Refund. Untuk Refund REJECTED atau FAILED, debit freeze itu sudah dibalik
oleh jurnal pembalik, dan bila escrow sudah dirilis, porsi net-nya dirilis lagi
dengan `paymentId` sehingga masuk `releasedAmount`. Hasilnya residual negatif
sebesar porsi escrow Refund itu, dan Payment dilaporkan sebagai
`strandedEscrow` (atau `tripStrandedEscrow`) pada setiap laporan, padahal
uangnya benar: alarm palsu yang tidak bisa diselesaikan Admin.

- [x] Tes merah dulu: Payment dengan Refund REJECTED (ditolak sebelum dan
      sesudah escrow dirilis) dan Refund FAILED tidak muncul di
      `strandedEscrow`, untuk Campaign dan Volunteer Trip
- [x] Payment yang benar-benar terdampar tetap dilaporkan (tes yang ada tetap hijau)
- [x] Perbaikan paling sederhana yang benar, misalnya mengecualikan Refund
      REJECTED/FAILED dari perhitungan `refundedAmount`, dengan komentar yang
      menjelaskan mengapa pasangan freeze dan pembaliknya saling meniadakan
- [x] Satu tes Postgres sungguhan
- [x] `mismatches` tidak memberi alarm palsu untuk Campaign yang punya Refund
      REJECTED atau FAILED, dan `collectedAmount` yang memang meleset tetap
      dilaporkan sebesar selisih sebenarnya (ditambahkan 2026-10-03 atas
      keputusan koordinator; tes merah dulu, unit dan Postgres sungguhan)

## Comments

- 2026-10-03, branch `claude/prd-52-reconcile-rejected-refund`: awaiting-merge.
  Commit kerja `dfc9baa` (kode dan tes); PR dibuat koordinator, jadi nomor PR
  dicatat koordinator saat PR dibuka. Commit tiket ini menyusul dan memuat sha
  itu.
  Reproduksi, merah dulu, dengan `route.ts` seperti di `96d9af3` dan Postgres
  sungguhan: Campaign yang Refund-nya ditolak lalu di-sweep dilaporkan di
  `strandedEscrow` dengan `creditedNet` 277500, `releasedAmount` 277500,
  `refundedAmount` 92500, `residual` -92500; Volunteer Trip dengan `residual`
  -190000 di `tripStrandedEscrow`. Hal yang sama untuk Refund yang ditolak
  sesudah sweep (dari AWAITING_DONOR_DETAILS, satu-satunya status selain
  REQUESTED yang boleh ditolak, dan sweep tidak menundanya) dan yang gagal
  sesudah sweep. Bukunya benar di ketiganya (ESCROW_HOLD 0, seluruh net menjadi
  saldo yang bisa dicairkan, FROZEN_BALANCE 0), jadi alarmnya palsu.
  Keputusan implementasi:
  - Satu baris di `route.ts`: query `refundsOnReleasedPayments` hanya memuat
    Refund dengan `status: { notIn: ['REJECTED', 'FAILED'] }`, bentuk yang sama
    dengan `impact.ts` dan `createRefund`. Komentarnya menjelaskan dua hal:
    penjumlahan di situ hanya leg DEBIT, jadi freeze terbaca tetapi pembaliknya
    (sebuah kredit) tidak; dan porsi yang dikembalikan keluar lagi dari
    ESCROW_HOLD dengan `paymentId` (oleh sweep, atau oleh `resolveRefund` bila
    escrow sudah dirilis sebelum Refund berakhir), jadi terhitung dua kali.
  - Akibat sebaliknya ikut benar. Di `96d9af3`, porsi yang sungguh tidak pernah
    dirilis sesudah Refund ditolak malah tersembunyi (residual 0, karena freeze
    yang sudah dibalik dihitung sebagai "refunded"); sekarang dilaporkan sebesar
    porsinya. Ada tesnya.
  - `escrow.ts`, `ledger.ts`, `refunds.ts` tidak disentuh (sedang diubah PR
    #205). Perbaikan ini tidak bergantung pada isinya: PR #205 (`382c0d4`)
    mengubah cara sweep dan approve membaca porsi fee, bukan jurnal reject/fail
    maupun rilis ber-`paymentId` yang dibaca laporan ini.
  - Fake `matchesWhere` di `route.test.ts` kini mendukung `notIn` dan melempar
    untuk filter yang tidak dikenal. Di `fdf7bbe` filter yang tidak dikenal
    diam-diam tidak cocok dengan apa pun; terbukti saat `notIn` belum didukung:
    semua Refund jatuh dari fake, dan enam tes "tidak dilaporkan" tetap lolos
    karena tidak ada masukan (hanya dua tes lain yang gagal).
  Tes, perintah yang mengulanginya:
  `TEST_DATABASE_URL='postgresql://ci:ci@localhost:5432/postgres?schema=public' npx vitest run src/app/api/admin/reconcile/route.test.ts src/__tests__/integration/reconcile-stranded-escrow-real-db.test.ts`
  hijau: 71 tes unit (62 yang lama dan 9 baru) dan 7 tes Postgres sungguhan
  (tiga akhir Refund untuk Campaign dan untuk Trip, ditambah satu kontrol:
  Payment yang benar-benar terdampar dilaporkan sebesar penuh walau ada Refund
  yang ditolak). Pada `route.ts` lama, 9 tes unit dan 7 tes Postgres merah.
  Mutasi, dikembalikan sesudahnya:
  `sed -i "s/status: { notIn: \['REJECTED', 'FAILED'\] }/status: { notIn: ['REJECTED'] }/" src/app/api/admin/reconcile/route.ts`
  lalu `npx vitest run src/app/api/admin/reconcile/route.test.ts` membuat dua
  tes gagal (kasus FAILED); dengan `['FAILED']` saja, tujuh tes gagal (kasus
  REJECTED).
  `node ci/ratchet.mjs`: tsc 19 dan lint 193, sama dengan baseline.
  Full suite sekali, atas izin koordinator, dengan `TEST_DATABASE_URL` seperti
  job test CI: 411 dari 412 berkas hijau (5415 tes lulus, 8 dilewati). Satu
  berkas gagal, `src/lib/drop-migration-guard.test.ts`, karena `TEST_DATABASE_URL`
  lokal menunjuk database `postgres` yang bukan milik role `ci` ("permission
  denied for database postgres"), bukan karena perubahan ini; dengan URL seperti
  di CI (`.../ci?schema=public`) berkas itu hijau, 7 tes.
  Di luar lingkup saat catatan ini ditulis (kemudian dikerjakan di tiket ini,
  lihat catatan lanjutan di bawah): bagian
  `mismatches` di route yang sama juga memberi alarm palsu untuk Campaign yang
  punya Refund REJECTED atau FAILED dengan freeze dari ESCROW_HOLD.
  `escrowCreditRows` menjumlah semua CREDIT ESCROW_HOLD, termasuk kredit jurnal
  pembalik (ber-`refundId`), jadi `ledgerAmount` kelebihan sebesar porsi itu.
  Terbukti di Postgres sungguhan dengan `collectedAmount` sama dengan gross:
  `collectedAmount` 300000, `ledgerAmount` 392500, `difference` -92500, di
  ketiga akhir Refund. Volunteer Trip tidak terkena karena `mismatches` hanya
  untuk Campaign. Kemungkinan arahnya: hanya hitung kredit settlement, yang
  membawa `paymentId`.
  Entri Refund di `CONTEXT.md` menyebut tiga pembaca yang tidak menghitung
  Refund REJECTED atau FAILED (batas Refund, sweep Escrow Hold, halaman
  Impact); laporan rekonsiliasi kini yang keempat. Tidak diubah di sini karena
  brief membatasi perubahan ke `route.ts` dan tes-tesnya.
- 2026-10-03, review sendiri oleh builder (skill `code-review`; kedua sumbu
  dijalankan berurutan karena subagent tidak bisa men-dispatch subagent). Diff
  kerja 656 baris tambahan dan 8 dihapus, di atas ~300, jadi `AGENTS.md`
  meminta review independen Standards dan Spec paralel dari koordinator. Standards: judul tes terpotong oleh
  `$name` dan nama akhir Refund dipendekkan; `leftAfterRefund` menjadi
  `netLessRefundShare` dan `refund` menjadi `refundAmount`; cast `as` di tes
  Postgres diganti `subjectId`; "used to" diganti "Until prd-compliance 52"
  (aturan klaim di `docs/agents/verification.md`). Smell, tidak diubah:
  bootstrap database tes Postgres sama dengan tes Postgres lain (konvensi repo:
  tiap berkas mandiri). Spec: empat acceptance terbukti. Di luar acceptance:
  guard `matchesWhere` (alasan di atas) dan dua kontrol (porsi tak dirilis
  tetap dilaporkan; Refund yang berdiri tetap dihitung). Tidak ada temuan keras
  yang tersisa.
- 2026-10-03, lanjutan atas keputusan koordinator, branch yang sama (owner sudah
  menyetujui tiket ini sebagai perbaikan alarm palsu reconcile untuk Refund yang
  ditolak atau gagal): alarm palsu `mismatches`, yang di catatan pertama ditulis
  sebagai di luar lingkup. Commit kerja kedua `35fcd05`; PR tetap dibuat
  koordinator. Sisi yang salah dipastikan dulu, dan bukan `collectedAmount`
  Campaign: tes Postgres membaca `collectedAmount` 300000 sesudah Refund ditolak
  atau gagal (angka yang benar: Donor membayar 300000 dan tidak ada yang
  kembali), dan tidak ada kode Refund yang menulisnya
  (`git grep -n collectedAmount -- src/lib/money/refunds.ts src/lib/volunteer/refunds.ts`
  tidak menemukan apa pun). Yang salah adalah rekonstruksi di laporan:
  `escrowCreditRows` menjumlah semua CREDIT ESCROW_HOLD, termasuk kredit jurnal
  pembalik yang ber-`refundId`, sehingga `ledgerAmount` 392500 untuk
  `collectedAmount` 300000.
  Keputusan implementasi:
  - Satu kata kunci di `route.ts`: `refundId: null` pada query `escrowCreditRows`,
    jadi hanya kredit Settlement yang dihitung, dengan komentar. Dipilih
    daripada `paymentId: { not: null }` karena tes lama memakai kredit
    ESCROW_HOLD tanpa `paymentId`, dan penyaring ini tidak pernah menyembunyikan
    kredit Settlement yang mungkin tidak ber-`paymentId`.
  - Akibat ikutan, sengaja dan ada tesnya: topangan shortfall Refund yang
    disetujui (kredit ke ESCROW_HOLD dari REFUND_COST, juga ber-`refundId`)
    tidak lagi dihitung sebagai uang yang dikreditkan ke Campaign.
  Tes: merah dulu pada `route.ts` seperti di `aeedf15`: 4 tes unit dan 4 tes
  Postgres sungguhan (ledgerAmount 392500, difference -92500; kontrol
  collectedAmount 310000 dilaporkan dengan difference -82500, seharusnya
  10000). Hijau sesudahnya, tanpa mengubah tes yang sudah ada di `main`: 76 tes
  unit dan 11 tes Postgres di dua berkas itu
  (`TEST_DATABASE_URL='postgresql://ci:ci@localhost:5432/postgres?schema=public' npx vitest run src/app/api/admin/reconcile/route.test.ts src/__tests__/integration/reconcile-stranded-escrow-real-db.test.ts`).
  Mutasi: menghapus `refundId: null` dari query itu membuat sembilan tes baru
  merah (lima unit, empat Postgres).
  `npx tsc --noEmit`: 19 galat, sama dengan baseline. `npx eslint` pada tiga
  berkas yang berubah hanya memuat dua galat lama di `route.ts` (impor
  `DEFERRED_ESCROW_WATCHDOG_DAYS` dan parameter `_req` yang tidak dipakai);
  lint seluruh repo tidak dijalankan ulang. Full suite tidak dijalankan ulang
  (builder tiket 53 berjalan paralel); hanya dua berkas tes reconcile di atas.
  Review sendiri atas diff tambahan (166 baris tambah, 11 dihapus, di bawah
  ~300): satu temuan, tes Postgres `mismatches` merujuk "books are right,
  above" padahal tidak menegaskannya; kini menegaskan `books` sendiri.
- 2026-10-03 (koordinator): PR #207; commit kerja `dfc9baa` (strandedEscrow) dan
  `35fcd05` (mismatches). Review independen (sonnet, satu reviewer karena kode
  produksi hanya `reconcile/route.ts`) tanpa blocking; komentar modul yang
  bertentangan dengan kredit cermin dan entri Refund di `CONTEXT.md` dirapikan
  di PR yang sama. Status menjadi `done` saat merge.

- 2026-10-03 (merge): PR #207 merge sebagai `25c23f4`, CI hijau, review independen diposting di PR.
