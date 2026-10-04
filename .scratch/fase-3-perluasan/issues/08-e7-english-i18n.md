# 08: E7 english-i18n

**Status:** needs-info

**Blocked by:** none (tiket); ADR pustaka dan konvensi kunci i18n (belum ada tiket, ditulis di Gelombang 1); ekstraksi penuh paling akhir dan sendirian (G5)

**Ukuran:** XL

**Catatan:** Menyentuh semua halaman: dikerjakan sendirian, tanpa builder lain berjalan paralel.

**Prasyarat:** ADR pustaka dan konvensi kunci ditulis di Gelombang 1 supaya layar baru langsung memakai kunci.

**Menunggu keputusan:** C23 (E7). Pustaka dan aturan slug. (rekomendasi: `next-intl`; slug tetap Indonesia)

## Latar

Versi bahasa Inggris seluruh situs. Saat ini belum ada pustaka i18n di `package.json`.

## Berkas relevan

- `docs/PRD-fund-for-indonesia.md:303` (§9 baris Bahasa)
- .scratch/prd-audit/research/01-fase-0-1.md
- `package.json` (hanya koordinator)

## Acceptance

- [ ] ADR i18n ditulis sebelum layar baru memakai kunci
- [ ] Ekstraksi teks seluruh halaman; slug tetap Indonesia
- [ ] Tes dan e2e untuk kedua bahasa

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Lajur E, relay kedua) dan `keputusan-ronde-c.md` (C23). Status `needs-info` karena grilling singkat dulu; acceptance di bawah sementara.
