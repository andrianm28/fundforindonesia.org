# 95: Header desktop: nama pengguna tidak bisa diklik, tidak ada jalan ke Akun atau keluar

**Type:** bug

**Status:** needs-triage

**Blocked by:** none

Ditemukan owner saat menyiapkan akun UAT di produksi pada 2026-10-16 ("tombol akun tidak bisa di klik").

## Gejala

Di layar lebar (`lg` ke atas), pengguna yang sudah masuk melihat avatar dan namanya di kanan atas header, tetapi elemen itu tidak bisa diklik. Bottom nav, satu-satunya tautan ke `/akun`, disembunyikan pada lebar yang sama. Akibatnya pengguna desktop tidak punya tombol untuk membuka halaman Akun atau keluar, dan harus mengetik `/akun` atau `/api/auth/signout` sendiri.

## Penyebab

`src/components/layout/DesktopHeader.tsx`, bagian `User Section`: untuk pengguna yang masuk, avatar dan nama dirender sebagai `<div>` biasa, tanpa `Link` dan tanpa menu. Tautan `/akun` hanya ada di `BottomNavBar.tsx` (tab "Akun"), yang tersembunyi di `lg+`. `signOut` hanya dipanggil dari `src/app/akun/page.tsx` dan `src/app/akun/pengaturan/page.tsx`.

## Kriteria penerimaan

- Di `lg+`, avatar dan nama pengguna yang masuk bisa diklik dan membawa ke `/akun`, atau membuka menu yang memuat setidaknya "Akun" dan "Keluar".
- "Keluar" memanggil `signOut({ callbackUrl: '/login' })`, sama dengan `/akun`.
- Elemen itu bisa dicapai dan diaktifkan dengan keyboard, dengan nama yang dapat diakses.
- Tes komponen `DesktopHeader` membuktikan tautan atau menu itu ada untuk pengguna yang masuk, dan tidak ada untuk tamu (tamu tetap melihat tombol "Masuk").

## Jalan pintas sampai diperbaiki

Buka `/akun` langsung (ada tombol keluar di sana), atau `/api/auth/signout`.

## Comments
