# 50: Kursi Batch bisa ditahan tanpa batas oleh satu akun

**Type:** implementation (keamanan)

**Status:** needs-info

**Blocked by:** PR #161 (membawa mekanisme rate limit yang dibutuhkan tiket ini). Tiket tetap `needs-info` sampai #161 merge dan owner memutuskan batas yang dipakai.

## Why

Audit keamanan alur Volunteer Trip (2026-10-02) menemukan celah bisnis pada
mekanisme penahanan kursi (hold): satu akun Volunteer bisa menahan kursi pada
banyak Batch tanpa membayar, sehingga Volunteer lain kehilangan kursi dan
Fundraiser kehilangan pendapatan.

Catatan: detail teknis (lokasi kode, langkah reproduksi, parameter) sengaja tidak
ditulis di sini karena `.scratch/` publik dan perbaikannya belum ada. Detail itu
disimpan owner di luar repo; builder memintanya ke owner saat tiket ini sudah
tidak terblokir.

## Scope

- Batasi jumlah penahanan kursi aktif per akun Volunteer; owner memutuskan
  cakupan batasnya (per Trip atau per Batch).
- Penahanan tambahan ditolak dengan pesan yang jelas bagi Volunteer.
- Tambahkan pembatasan laju (rate limit) pada pembuatan penahanan, memakai
  mekanisme dari PR #161 setelah merge.
- Dikerjakan di bawah urutan lock yang sudah berlaku di modul Volunteer.

## Acceptance

- Tes: akun dengan penahanan aktif tidak bisa membuat penahanan baru; penahanan
  yang sudah hangus tidak menghalangi.
- Tes: pembuatan penahanan beruntun dibatasi.
- PR #161 sudah merge sebelum PR ini.

## Comments

- 2026-10-02: status `needs-info` karena terblokir PR #161 dan batas penahanan belum diputuskan owner. Isi tiket diredaksi sampai setingkat peran (gap `.scratch` publik); detail teknis disimpan owner di luar repo.

- 2026-10-04 (ronde C): owner memutuskan batas hold (C16, sesuai rekomendasi); angkanya tersamar dan tidak ditulis di repo. Status tetap `needs-info` sampai PR #161 merge. Tiket build: 82.
