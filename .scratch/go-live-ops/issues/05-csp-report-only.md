# 05: H-3b csp-report-only

**Status:** ready-for-agent

**Blocked by:** none

**Ukuran:** S

**Catatan:** Header keamanan; tanpa skema. Penegakan CSP ada di G5 (bukan tiket ini).

## Latar

Pasang CSP dalam mode report-only agar pelanggaran terlihat sebelum ditegakkan, plus Permissions-Policy.

## Berkas relevan

- `next.config.*` atau `middleware`
- `src/app/layout.tsx`

## Acceptance

- [ ] Header `Content-Security-Policy-Report-Only` dan `Permissions-Policy` ada di respons halaman publik dan Admin
- [ ] Halaman utama, donasi, dan login tetap berfungsi (e2e hijau)
- [ ] Tes bahwa header ada; tidak ada header CSP enforce
- [ ] Titik laporan tidak menyimpan data pribadi

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
