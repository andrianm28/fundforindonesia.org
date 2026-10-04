# 60: robots.txt untuk halaman privat; matikan header X-Powered-By

**Type:** implementation (hardening, SEO)

**Status:** awaiting-merge

**Blocked by:** none

## Why

Situs belum punya `robots.txt`, sehingga crawler bebas menyentuh `/admin`,
`/moderasi`, `/api` dan halaman akun. Next juga mengirim header
`X-Powered-By: Next.js` yang membocorkan stack tanpa guna.

## Scope

- `src/app/robots.ts`: `Disallow` untuk `/admin`, `/moderasi`, `/api`, `/akun`,
  `/donasi-saya`, `/inbox`, `/campaign/create`, `/volunteer-trip/registrasi`,
  `/receipt/`, `/akad-wakaf/`, `/sertifikat/` (halaman bertoken atau privat).
  Merujuk sitemap lewat `publicUrl('/sitemap.xml')` dan `host`.
- `poweredByHeader: false` di `next.config.mjs`.
- Tanpa migrasi.

## Acceptance

- [x] Tes: robots memblokir semua path privat di atas untuk `*`.
- [x] Tes: robots tidak memblokir halaman publik yang ada di sitemap (`/`, `/explore`, `/zakat`, `/login`, `/register`, `/campaign/...`).
- [x] Tes: robots menunjuk sitemap di URL publik kanonik.
- [x] Tes: `next.config` punya `poweredByHeader: false`.

## Comments

- 2026-10-04: owner menyetujui rencana ini. Status `ready-for-agent`.
