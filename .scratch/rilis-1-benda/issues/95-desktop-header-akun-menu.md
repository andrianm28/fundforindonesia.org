# 95: Header desktop: nama pengguna tidak bisa diklik, tidak ada jalan ke Akun atau keluar

**Type:** bug

**Status:** done

**Blocked by:** none

Ditemukan owner saat menyiapkan akun UAT di produksi pada 2026-10-16 ("tombol akun tidak bisa di klik").

## Gejala

Di layar lebar (`lg` ke atas), pengguna yang sudah masuk melihat avatar dan namanya di kanan atas header, tetapi elemen itu tidak bisa diklik. Bottom nav, satu-satunya tautan ke `/akun`, disembunyikan pada lebar yang sama. Akibatnya pengguna desktop tidak punya tombol untuk membuka halaman Akun atau keluar, dan harus mengetik `/akun` atau `/api/auth/signout` sendiri.

## Penyebab

`src/components/layout/DesktopHeader.tsx`, bagian `User Section`: untuk pengguna yang masuk, avatar dan nama dirender sebagai `<div>` biasa, tanpa `Link` dan tanpa menu. Tautan `/akun` hanya ada di `BottomNavBar.tsx` (tab "Akun"), yang tersembunyi di `lg+`. `signOut` hanya dipanggil dari `src/app/akun/page.tsx` dan `src/app/akun/pengaturan/page.tsx`.

## Kriteria penerimaan

- [x] Di `lg+`, avatar dan nama pengguna yang masuk bisa diklik dan membawa ke `/akun`, atau membuka menu yang memuat setidaknya "Akun" dan "Keluar".
- [x] "Keluar" memanggil `signOut({ callbackUrl: '/login' })`, sama dengan `/akun`.
- [x] Elemen itu bisa dicapai dan diaktifkan dengan keyboard, dengan nama yang dapat diakses.
- [x] Tes komponen `DesktopHeader` membuktikan tautan atau menu itu ada untuk pengguna yang masuk, dan tidak ada untuk tamu (tamu tetap melihat tombol "Masuk").

## Jalan pintas sampai diperbaiki

Buka `/akun` langsung (ada tombol keluar di sana), atau `/api/auth/signout`.

## Comments

### 2026-10-16

`DesktopHeader.tsx`: avatar dan nama pengguna yang masuk kini menjadi `<button>` (`aria-haspopup="menu"`, `aria-expanded`, `aria-label="Menu akun <nama>"`) yang membuka menu berisi "Akun" (tautan ke `/akun`) dan "Keluar" (`signOut({ callbackUrl: '/login' })`, sama dengan `/akun`). Menu menutup dengan Escape (fokus kembali ke tombol), klik di luar, dan klik tombol lagi. Tamu tetap hanya melihat "Masuk". Enam tes komponen baru di `DesktopHeader.test.tsx`; `src/components/layout` 43 tes hijau, tsc 19 error (tidak naik), eslint tanpa error baru.
