# 08: E7 english-i18n

**Status:** ready-for-agent

**Blocked by:** none (tiket); ADR i18n (pustaka, konvensi kunci, peta pathname per bahasa, canonical, hreflang) ditulis di Gelombang 1 sebelum ekstraksi; ekstraksi penuh paling akhir dan sendirian (G5)

**Ukuran:** XL

**Catatan:** Menyentuh semua halaman: dikerjakan sendirian, tanpa builder lain berjalan paralel.

**Prasyarat:** ADR pustaka dan konvensi kunci ditulis di Gelombang 1 supaya layar baru langsung memakai kunci.

**Keputusan (2026-10-04, ronde C):** E7 memakai `next-intl` dengan **slug diterjemahkan** (bukan slug Indonesia untuk semua bahasa).

## Latar

Versi bahasa Inggris seluruh situs. Saat ini belum ada pustaka i18n di `package.json`.

## Berkas relevan

- `docs/PRD-fund-for-indonesia.md:303` (§9 baris Bahasa)
- .scratch/prd-audit/research/01-fase-0-1.md
- `package.json` (hanya koordinator)

## Acceptance

- [ ] ADR i18n ditulis sebelum layar baru memakai kunci; ADR **harus** mendefinisikan peta pathname per bahasa (slug diterjemahkan), URL canonical, dan hreflang
- [ ] Ekstraksi teks seluruh halaman; pathname dan slug diterjemahkan per bahasa lewat peta di ADR, dengan redirect dari pathname bahasa lain bila perlu, canonical, dan hreflang untuk tiap pasangan halaman
- [ ] Tes dan e2e untuk kedua bahasa

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Lajur E, relay kedua) dan `keputusan-ronde-c.md` (C23). Status `needs-info` karena grilling singkat dulu; acceptance di bawah sementara.

- 2026-10-04 (ronde C): E7 dijawab owner, menyimpang dari rekomendasi: `next-intl` dengan **slug diterjemahkan**, bukan slug Indonesia. Akibat: ADR i18n harus mendefinisikan **peta pathname per bahasa**, **canonical**, dan **hreflang**; sitemap memuat tiap versi bahasa. Tiket ADR belum ada (ditulis koordinator di Gelombang 1) dan tiket ini dikerjakan sendirian di G5 setelah ADR; itu urutan kerja, bukan pertanyaan terbuka. `needs-info` menjadi `ready-for-agent`.
