# 48: Batch yang sudah punya Registration berbayar tidak boleh diubah tanggal dan kuotanya sesuka hati

**Type:** implementation (keamanan, kode uang)

**Status:** in-review

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02, `origin/main` 0f827b1)
menemukan celah severity **high** pada jalur uang Trip Fee. Tidak ada tiket lain
yang menutupnya.

`editBatch` (`src/lib/volunteer/trip.ts:564-579`) mengubah `startDate`, `endDate`,
`registrationDeadline`, `maxQuota`, `minQuota` pada Batch OPEN tanpa melihat
apakah sudah ada Registration CONFIRMED, dan tanpa membandingkan tanggal dengan
`now`. Satu-satunya aturan adalah `requireConsistentBatch` (`trip.ts:479-489`):
`minQuota <= maxQuota`, `endDate >= startDate`, `registrationDeadline <= startDate`.
Skema `editBatchSchema` (`src/app/api/volunteer-trips/[slug]/batches/[id]/route.ts:8-14`)
hanya memeriksa bentuk. Pemilik Trip (atau Admin) boleh memanggilnya
(`route.ts:50`).

Skenario serangan (Fundraiser nakal, Trip ACTIVE, Volunteer sudah bayar):

1. Fundraiser `PATCH` Batch: `startDate` dan `endDate` ke masa lalu (atau `startDate`
   ke < 3 hari dari sekarang), `registrationDeadline` disesuaikan.
2. Tabel refund Volunteer dihitung dari `batch.startDate`
   (`src/lib/volunteer/refunds.ts:33-37`, dipakai `cancelRegistration`,
   `trip.ts:905`): `daysToDeparture < 3` berarti refund 0. Volunteer yang
   membatalkan tidak mendapat apa-apa.
3. Karena `endDate` sudah lewat, Fundraiser memanggil `complete` (`trip.ts:609`
   lolos), Batch menjadi COMPLETED, dan `cancelRegistration` menolak dengan
   `BatchAlreadyCompletedError` (`trip.ts:894`). Volunteer tak punya jalan keluar;
   `cancelBatch` pun tertutup karena Batch bukan OPEN.
4. Trip Fee tidak punya syarat apa pun untuk Payout selain "bukan Suspended"
   (`src/lib/money/payouts.ts:157-160`, `src/lib/subject-guard.ts:257-258`), jadi
   setelah Escrow Hold 7 hari dari settlement Fundraiser mengajukan Payout atas
   `TRIP_BALANCE`. Sebelum itu pun, Volunteer yang membatalkan di jendela 3-13 hari
   lalu dibayar dari pool yang sudah dikuras Payout lewat `shortfall`
   (`src/lib/money/refunds.ts:approveRefund`), yakni uang platform.

Variasi yang lebih ringan: `maxQuota` bisa diturunkan di bawah jumlah Registration
CONFIRMED, dan `minQuota` dinaikkan di atas jumlah CONFIRMED agar `cancelBatch`
(`trip.ts:678`) lolos untuk membatalkan Batch sesuka hati.

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
