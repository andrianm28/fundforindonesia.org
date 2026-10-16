# 05: H-3b csp-report-only

**Status:** done

**Blocked by:** none

**Ukuran:** S

**Catatan:** Header keamanan; tanpa skema. Penegakan CSP ada di G5 (bukan tiket ini).

## Latar

Pasang CSP dalam mode report-only agar pelanggaran terlihat sebelum ditegakkan, plus Permissions-Policy.

## Berkas relevan

- `next.config.*` atau `middleware`
- `src/app/layout.tsx`

## Acceptance

- [x] Header `Content-Security-Policy-Report-Only` dan `Permissions-Policy` ada di respons halaman publik dan Admin
- [x] Halaman utama, donasi, dan login tetap berfungsi (e2e hijau)
- [x] Tes bahwa header ada; tidak ada header CSP enforce
- [x] Titik laporan tidak menyimpan data pribadi

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
- 2026-10-16: dikerjakan bersama perbaikan audit 2026-10-16. Header dipasang site-wide di `next.config.mjs` (diuji `src/next-config.test.ts`), plus `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS tanpa `includeSubDomains`. Belum ada titik laporan (`report-uri`): pelanggaran tampil di konsol browser, jadi tidak ada data pribadi yang disimpan. Titik laporan dan penegakan tetap di G5.
