# 48: Batch yang sudah punya Registration berbayar tidak boleh diubah tanggal dan kuotanya sesuka hati

**Type:** implementation (keamanan, kode uang)

**Status:** in-review

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02) menemukan celah severity **high** pada jalur uang Trip Fee: Batch yang sudah punya Registration berbayar masih bisa diubah tanggal dan kuotanya, sehingga hak Volunteer atas refund dan Payout Trip Fee tidak terjaga. Tidak ada tiket lain yang menutupnya.

Detail teknis eksposur disimpan owner di luar repo publik; lihat PR #170 untuk perbaikan.

## Scope

- `editBatch`: bila Batch punya Registration HOLD atau CONFIRMED, tolak perubahan
  `startDate`, `endDate`, dan `registrationDeadline` yang memajukan atau
  menggeser tanggal (putuskan dengan owner: dilarang sama sekali, atau hanya boleh
  memundurkan dan tiap Volunteer terdampak diberi refund penuh / pemberitahuan),
  tolak `maxQuota` < jumlah seat terpakai, dan tolak `minQuota` yang dinaikkan di
  atas jumlah CONFIRMED saat ini. Dikerjakan di bawah lock Trip -> Batch ->
  Registrations (urutan `trip.ts` header), bukan di route.
- `createBatch`/`editBatch`: tanggal baru harus di masa depan terhadap `now`
  (`startDate > now`, `registrationDeadline > now`).
- Tabel refund yang ditampilkan ke Volunteer sebelum membayar memakai tanggal yang
  sama dengan yang dibekukan; pertimbangkan membekukan `startDate` pada Registration
  saat hold, atau refund memakai tanggal terdahulu bila Batch diubah.
- Bahas dengan owner (di luar kode tiket ini bila perlu tiket lain): Payout Trip Fee
  sebaiknya menunggu Batch COMPLETED atau tanggal keberangkatan lewat, dan tidak
  boleh menguras pool selagi masih ada Registration CONFIRMED yang bisa di-refund.

## Acceptance

- Tes: Batch dengan Registration CONFIRMED menolak `startDate`/`endDate` ke masa
  lalu, menolak `maxQuota` di bawah seat terpakai, menolak `minQuota` di atas
  jumlah CONFIRMED; Batch kosong tetap bisa diedit bebas.
- Tes: `completeBatch` pada Batch yang tanggalnya baru dipindah ke masa lalu tidak
  melewati penjagaan di atas.
- Menyentuh kode uang di `src/lib/volunteer/trip.ts`: review independen `sonnet`
  wajib dan ketiga canary carry-trap harus sama dengan `main`.
