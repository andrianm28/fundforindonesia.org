# 86: Pintu masuk ke /admin dan /moderasi menurut assignment

**Type:** feature (UI kecil)

**Status:** awaiting-merge

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

- [x] Pengguna yang memegang assignment ADMIN melihat tautan ke `/admin` di `/akun` dan di header desktop.
- [x] Pengguna yang memegang assignment VERIFIER (assignment yang dipakai guard `/moderasi`) melihat tautan ke `/moderasi` di tempat yang sama.
- [x] Pemegang kedua assignment melihat kedua tautan (satu navigasi, bagian sesuai assignment; tidak ada layar eksklusif).
- [x] Pengguna tanpa assignment itu, dan pengunjung tanpa sesi, tidak melihat tautan apa pun.
- [x] Penentuan memakai `hasAssignment` yang sama dengan guard halaman; tidak ada salinan logika peran.
- [x] Tes; tanpa migrasi, tanpa menyentuh `AdminSidebar.tsx`.

## Comments
- 2026-10-04, branch `claude/rilis-1-86-admin-moderasi-door`: `hasAssignment` dipindah ke `src/lib/assignment.ts` (bebas modul server, di-re-export dari `withAssignmentCheck` sehingga impor lama tetap jalan) agar komponen klien memakai cek yang sama dengan guard halaman. `staffEntryLinks` (`src/lib/staff-entry-links.ts`) memetakan ADMIN -> /admin, VERIFIER -> /moderasi; dipakai di `/akun` (daftar tautan) dan `DesktopHeader` (via `AppShell`). Enum `Assignment` hanya punya ADMIN dan VERIFIER, jadi "siapa pun yang boleh moderasi" = VERIFIER, sama seperti guard `/moderasi`. Tanpa migrasi; `AdminSidebar` tidak disentuh. BottomNavBar tidak diubah: tab Akun sudah mengarah ke `/akun`.
