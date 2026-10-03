# 52: Laporan reconcile menandai Payment dengan Refund REJECTED/FAILED sebagai strandedEscrow

**Status:** ready-for-agent

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

- [ ] Tes merah dulu: Payment dengan Refund REJECTED (ditolak sebelum dan
      sesudah escrow dirilis) dan Refund FAILED tidak muncul di
      `strandedEscrow`, untuk Campaign dan Volunteer Trip
- [ ] Payment yang benar-benar terdampar tetap dilaporkan (tes yang ada tetap hijau)
- [ ] Perbaikan paling sederhana yang benar, misalnya mengecualikan Refund
      REJECTED/FAILED dari perhitungan `refundedAmount`, dengan komentar yang
      menjelaskan mengapa pasangan freeze dan pembaliknya saling meniadakan
- [ ] Satu tes Postgres sungguhan

## Comments
