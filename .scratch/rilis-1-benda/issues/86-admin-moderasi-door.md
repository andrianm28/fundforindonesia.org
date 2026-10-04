# 86: Pintu masuk ke /admin dan /moderasi menurut assignment

**Type:** feature (UI kecil)

**Status:** ready-for-agent

**Blocked by:** none

Ukuran S. Menjalankan keputusan owner di `05-two-assignments-one-person.md`
(2026-09-28, butir 3): satu navigasi, bagian tampil sesuai assignment yang
dipegang.

## Konteks

Halaman `/admin` dan `/moderasi` sudah menjaga diri lewat `hasAssignment`
(ADR 0005: assignment, bukan rank). Tetapi tidak ada tautan ke keduanya dari
navigasi atau akun pengguna; staf harus mengetik URL. Penentuan peran harus
memakai helper otorisasi yang sama (`hasAssignment`), bukan logika peran baru.

## Acceptance criteria

- [ ] Pengguna yang memegang assignment ADMIN melihat tautan ke `/admin` di `/akun` dan di header desktop.
- [ ] Pengguna yang memegang assignment VERIFIER (assignment yang dipakai guard `/moderasi`) melihat tautan ke `/moderasi` di tempat yang sama.
- [ ] Pemegang kedua assignment melihat kedua tautan (satu navigasi, bagian sesuai assignment; tidak ada layar eksklusif).
- [ ] Pengguna tanpa assignment itu, dan pengunjung tanpa sesi, tidak melihat tautan apa pun.
- [ ] Penentuan memakai `hasAssignment` yang sama dengan guard halaman; tidak ada salinan logika peran.
- [ ] Tes; tanpa migrasi, tanpa menyentuh `AdminSidebar.tsx`.

## Comments
