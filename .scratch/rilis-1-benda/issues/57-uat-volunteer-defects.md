# 57: Lima defect UAT lokal pada alur Volunteer Trip

**Type:** bug (ditulis retroaktif)

**Status:** awaiting-merge

**Blocked by:** none

## Konteks

UAT lokal alur Volunteer Trip menemukan lima defect. Tiket ini ditulis
retroaktif setelah pekerjaan selesai, dan **gejala UAT tidak tercatat**: PR #173
(deskripsi) dan commit 59ff8ba hanya mencatat perbaikannya, bukan apa yang
diamati penguji (layar, langkah, pesan error). Jangan membaca daftar di bawah
sebagai laporan gejala.

Yang bisa dilacak ke sumbernya, sebagai penyebab menurut kode dan bukan gejala
yang diamati:

- Cover image: `z.string().url()` menolak path relatif `/uploads/...` yang
  dikembalikan `/api/upload` (komentar `src/lib/cover-image.ts`, PR #173).
- `HoldCountdown`: jam server dan klien berbeda pada render pertama, yang
  menimbulkan hydration mismatch (komentar `HoldCountdown.tsx`).
- Tiga defect lain (metode pembayaran, tanggal WIB, pesan Batch): hanya
  perbaikannya yang tercatat (commit 59ff8ba).

Kriteria penerimaan di bawah awalnya mengikuti kode, sehingga dua celah lolos:
tanggal WIB baru diterapkan di halaman akun, dan halaman pendaftaran masih
jatuh diam-diam ke `qris` (code-review PR #173). Keduanya kini tercakup.

## Cakupan

1. **Cover image**: `coverImageSchema` (`src/lib/cover-image.ts`) menerima path
   `/uploads/<nama-aman>` yang dikembalikan `/api/upload`, atau URL https.
   Sebelumnya `z.string().url()` menolak setiap hasil upload. Menolak path
   traversal, `http:`, `javascript:`, `data:`, userinfo, dan spasi di tepi.
   Dipakai di route Trip dan Campaign (create dan update).
2. **Metode pembayaran**: tombol Registration memakai metode yang didukung
   provider aktif (`src/lib/volunteer/payment-method.ts`), tidak lagi
   di-hardcode. `registrationMethodFor` exhaustive; nilai tak dikenal dilempar.
3. **Tanggal WIB**: tanggal Batch Fundraiser ditampilkan sebagai tanggal
   kalender WIB (`formatWibDate`).
4. **Hydration `HoldCountdown`**: menggambar placeholder sampai ter-mount,
   sehingga tidak ada hydration mismatch.
5. **Pesan Batch**: penolakan tanggal dan kuota Batch menjadi satu pesan
   berbahasa Indonesia dengan label form.

Perbaikan dari review: bila upload cover gagal di `campaign/create/page.tsx`,
submit berhenti dengan pesan error dan tidak ada POST (sebelumnya mengirim
placeholder atau blob URL yang kini ditolak server).

## Kriteria penerimaan

- [x] Cover image `/uploads/<nama-aman>` dan https diterima; traversal, `%2e%2e`, `//host`, `javascript:`, `data:`, `http:`, userinfo, dan whitespace tepi ditolak.
- [x] Route Trip dan Campaign (POST dan PATCH) memakai `coverImageSchema`, dengan tes.
- [x] Metode Registration mengikuti provider aktif; provider tak dikenal tidak jatuh diam-diam ke `qris`.
- [x] Tanggal Batch tampil sebagai tanggal WIB.
- [x] Tanggal WIB juga berlaku di halaman publik: rentang Batch dan tenggat di `volunteer-trip/[slug]`, serta `nearestBatchStart` di katalog `volunteer-trip`, dengan tes untuk tanggal yang melewati batas hari UTC/WIB. Helper tanggal WIB ada di satu modul (`src/lib/volunteer/batch-dates.ts`).
- [x] Fallback `qris` di halaman `daftar/[batchId]` hanya berlaku untuk provider yang tidak terkonfigurasi (`PaymentProviderNotConfiguredError`); metode atau provider yang tidak dikenal dilempar, dengan tes. Prop `paymentMethod` di `RegisterButton` wajib.
- [x] `HoldCountdown` tidak menyebabkan hydration mismatch.
- [x] Penolakan Batch menampilkan satu pesan Indonesia dengan label form.
- [x] Upload cover gagal menghentikan submit tanpa POST, dengan tes komponen.
- [x] Review independen `sonnet` dan re-review `haiku`: semua temuan (satu blocking, dua should-fix) tertangani.
- [x] 880 tes terarah lulus; ratchet di baseline (lint 193, tsc 47); `next build` lolos. Full suite lewat CI.

## Catatan

Fallback placeholder `/images/placeholder-campaign.jpg` kini ditolak server;
form tidak lagi mengirimnya.

## Comments

- 2026-10-02: tiket ditulis retroaktif oleh koordinator; pekerjaan dibangun sebelum tiket ada (gap alur). PR #173, commit 49f95dd.
