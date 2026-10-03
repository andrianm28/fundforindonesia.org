# 49: Refund bisa ditolak sebelum approve dan ditandai gagal setelahnya

**Status:** done (PR #203, 25b98f4)

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

- [x] `rejectRefund` dan `failRefund` di `src/lib/money/refunds.ts`, masing-masing
      di bawah lock yang sama dengan approve/complete, menulis status, aktor,
      waktu, dan alasan
- [x] Jurnal pembalik seimbang dan mengembalikan uang persis ke akun yang
      di-debit; termasuk kasus shortfall yang ditutup `REFUND_COST` saat approve
- [x] Aturan aktor ditegakkan di domain; aksi kedua atau status yang salah
      mendapat 409 tanpa perubahan apa pun
- [x] Refund yang ditolak atau gagal tidak lagi dihitung oleh cap Refund
      (`notIn: ['REJECTED','FAILED']` sudah ada) dan tidak lagi menahan sweep escrow
- [x] Route Admin untuk kedua aksi, mengikuti pola route Refund yang ada
- [x] Tes unit di seam publik dan tes Postgres sungguhan untuk reject dan fail,
      termasuk balapan reject vs approve

## Comments

- 2026-10-03, branch `claude/prd-49-refund-reject-fail`: `rejectRefund` (REQUESTED
  atau AWAITING_DONOR_DETAILS) dan `failRefund` (APPROVED) di `refunds.ts`, satu
  fungsi bersama di bawah lock subjek lalu klaim baris Refund. Jurnal pembalik
  dibangun dari ENTRI yang sudah diposting (`reverseEntriesLegs`, freeze untuk
  tolak; freeze + approve untuk gagal), bukan dihitung ulang dari Payment, jadi
  akun asal dan shortfall `REFUND_COST` kembali persis. Bila freeze mendebit
  `ESCROW_HOLD` dan escrow Payment sudah dirilis sweep (sweep tidak menunda untuk
  APPROVED), bagian net itu juga dirilis ke saldo agar tidak tertinggal di hold.
  Migrasi `20261003030000`: enam kolom nullable (rejected*/failed*). Error baru
  `REFUND_RESOLUTION_ACTOR` (403) dan `REFUND_REASON_INVALID` (400); status salah
  atau aksi kedua tetap `INVALID_REFUND_STATUS` (409), pesannya dibuat generik.
  Route PATCH `.../refunds/[id]/reject` dan `/fail` untuk Campaign dan Volunteer
  Trip. Tes: unit, route, dan Postgres sungguhan (termasuk balapan reject vs
  approve). Belum ada UI Admin untuk kedua aksi.
- 2026-10-03, perbaikan review: `impactBreakdown` mengecualikan Refund
  REJECTED/FAILED dari `refunds`, dan query shortfall kini dibatasi `refundId in
  refundIds`, jadi pasangan asli dan pembaliknya sama-sama tidak dibaca (net nol,
  hukum konservasi tetap). Tes Impact (in-memory dan Postgres sungguhan: reject
  setelah freeze, fail setelah approve dengan shortfall `REFUND_COST`). Empat
  route baru didaftarkan di `roles-expand-guard`, entri Refund di `CONTEXT.md`
  dilengkapi, dan tes route Volunteer Trip ditambahkan.

- 2026-10-03 (merge): PR #203 merge sebagai `25b98f4`, CI hijau, review independen diposting di PR.
