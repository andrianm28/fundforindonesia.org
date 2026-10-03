# 53: createRefund menghitung ulang porsi fee sehingga fee terakui kurang setelah Refund ditolak

**Status:** ready-for-agent

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

- [ ] Tes merah dulu (unit dan satu tes Postgres sungguhan) untuk urutan di atas,
      termasuk Refund penuh setelah penolakan: total fee terakui atas Refund yang
      berdiri sama persis dengan porsi kumulatifnya, dan `ESCROW_HOLD` tidak
      pernah negatif
- [ ] Porsi fee Refund baru dihitung dari fee yang sudah diposting oleh jurnal
      freeze Refund yang masih berdiri (helper `refundFreezeDebit` dari #205),
      bukan dari daftar jumlah
- [ ] Tes yang membunuh mutan "approve mengabaikan PLATFORM_FEE atau
      REFUND_COST": pool terkuras, R1 dan R2 terbuka, R1 di-approve lebih dulu
      (shortfall 47.499), saldo ditegaskan persis
- [ ] Perilaku tanpa penolakan tidak berubah (tes yang ada tetap hijau)

## Comments
