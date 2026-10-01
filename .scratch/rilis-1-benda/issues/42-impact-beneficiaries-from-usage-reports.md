# 42: Halaman Impact menghitung penerima manfaat dari Usage Report

**Type:** implementation

**Status:** done

**Blocked by:** none

## Why

UAT putaran 2 (2026-09-29): setelah sebuah Usage Report berisi 150 penerima
manfaat terkirim, `/impact` tetap menampilkan "Penerima manfaat 0 orang" dan
"belum ada satu pun Usage Report". Penyebabnya, `impactBreakdown`
(`src/lib/money/impact.ts`) menulis `beneficiaries: 0` secara tetap dan komentarnya
masih menyebut Usage Report sebagai "tiket berikutnya", padahal model
`UsageReport.beneficiaryCount` sudah ada sejak tiket 22 dan schema-nya sendiri
berkomentar bahwa angka itu "the same figure the Impact & Transparency page sums".
Ini halaman transparansi publik: angkanya salah bagi Donor yang membacanya.
Disetujui owner 2026-10-01 ("ya semua").

## Scope

- `impactBreakdown` menjumlahkan `UsageReport.beneficiaryCount` untuk semua Usage
  Report yang sudah terkirim, dengan cakupan yang sama dengan baris lain di halaman
  itu: bukan Campaign demo, dan mengikuti filter lokasi bila ada. Satu Usage Report
  per Payout (sudah unik di skema), jadi tidak ada penghitungan ganda.
- Usage Report yang ditandai "dipertanyakan" tetap dihitung dan tidak disembunyikan
  (ia tampil publik berikut alasannya); jangan menambah aturan baru di sini.
- Perbarui komentar dan teks catatan (`notes`): bila ada Usage Report, jangan
  tampilkan "belum ada satu pun Usage Report"; bila belum ada, tetap tampilkan
  catatan itu dan angka nol.
- Tidak mengubah garis uang, rekonsiliasi (`ImpactDoesNotReconcileError`), atau
  skema. `beneficiaries` tidak ikut dalam jumlah rupiah mana pun.

## Acceptance

- Tes: tanpa Usage Report angkanya nol dengan catatan lama; dengan beberapa
  Usage Report angkanya jumlah `beneficiaryCount`; filter lokasi membatasi; Campaign
  demo tidak dihitung; Usage Report yang ditandai dipertanyakan tetap dihitung.
- Halaman `/impact` menampilkan angkanya (tes halaman bila ada).
- Menyentuh `src/lib/money/impact.ts`: review independen `sonnet` wajib, dan ketiga
  canary carry-trap harus sama dengan `main`.
