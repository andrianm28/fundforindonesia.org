# 49: Refund bisa ditolak sebelum approve dan ditandai gagal setelahnya

**Status:** ready-for-agent

**Blocked by:** none (32 done; menjawab tiket riset 33)

Refund membekukan uang Campaign saat dibuat (`FROZEN_BALANCE`), dan Refund
APPROVED memindahkannya ke `REFUND_CLEARING`. Tidak ada jalan pulang: status
`REJECTED` dan `FAILED` tidak punya penulis di kode produksi, sehingga Refund
yang keliru atau yang gagal dibayar mengunci uang Campaign selamanya (tiket 33).

Keputusan owner 2026-10-03:

- **Tolak** hanya berlaku untuk Refund `REQUESTED` (dan
  `AWAITING_DONOR_DETAILS` bila status itu dipakai). Boleh dilakukan Admin mana
  pun selain pembuat Refund dan selain Fundraiser Campaign itu. Pembekuan
  dikembalikan ke akun asal tempat ia diambil (jurnal kebalikan dari freeze).
- **Gagal** berlaku untuk Refund `APPROVED` yang tidak bisa dibayar. Ditandai
  oleh Admin yang bukan pemberi persetujuan dan bukan Fundraiser Campaign. Uang
  kembali dari `REFUND_CLEARING` ke akun asal.
- Refund yang sudah `COMPLETED` tidak bisa ditolak maupun digagalkan.

- [ ] `rejectRefund` dan `failRefund` di `src/lib/money/refunds.ts`, masing-masing
      di bawah lock yang sama dengan approve/complete, menulis status, aktor,
      waktu, dan alasan
- [ ] Jurnal pembalik seimbang dan mengembalikan uang persis ke akun yang
      di-debit; termasuk kasus shortfall yang ditutup `REFUND_COST` saat approve
- [ ] Aturan aktor ditegakkan di domain; aksi kedua atau status yang salah
      mendapat 409 tanpa perubahan apa pun
- [ ] Refund yang ditolak atau gagal tidak lagi dihitung oleh cap Refund
      (`notIn: ['REJECTED','FAILED']` sudah ada) dan tidak lagi menahan sweep escrow
- [ ] Route Admin untuk kedua aksi, mengikuti pola route Refund yang ada
- [ ] Tes unit di seam publik dan tes Postgres sungguhan untuk reject dan fail,
      termasuk balapan reject vs approve

## Comments
