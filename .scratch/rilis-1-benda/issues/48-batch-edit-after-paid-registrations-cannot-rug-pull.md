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

Dampak (setingkat peran): Pemilik Trip dapat mengubah jadwal dan kuota Batch
yang sudah punya Volunteer berbayar sehingga hak refund Volunteer hilang atau
terkunci, dan platform menanggung selisihnya. Detail rangkaian langkah
disengaja tidak ditulis di sini.

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

## Comments

- 2026-10-02: ditriase retroaktif oleh koordinator (gap alur: builder di-dispatch saat masih needs-triage); owner menyetujui cakupan lewat "ya" 2026-10-02. Dibangun di PR #170.
- 2026-10-02: scope tambahan: OwnTripRegistrationError (pemilik Trip tidak boleh mendaftar di Trip sendiri), endDate harus di masa depan, dan form Batch read-only saat terkunci; berasal dari audit, menunggu konfirmasi owner.
- 2026-10-02: pilihan implementasi: tanggal Batch berisi Registration live dilarang berubah sama sekali (termasuk memundurkan); menunggu konfirmasi owner. Payout menunggu COMPLETED ditangani tiket 49 (PR #176).
