# 75: P3 wakaf-hibah-csr-landings-and-zakat-cta

**Status:** ready-for-agent

**Blocked by:** none; C7 dan C9 dijawab owner 2026-10-04

**Ukuran:** M

**Catatan:** Halaman publik; tanpa skema.

**Keputusan (2026-10-04, ronde C):** C7 Kind yang dibuka saat peluncuran hanya `donation`; C9 kategori wakaf adalah empat kategori PRD §6 (masjid, sekolah, fasilitas kesehatan, fasilitas umum).

## Latar

Belum ada landing untuk wakaf, hibah, dan CSR, tautan ke /program belum dipasang, dan halaman zakat belum punya CTA. Isi landing bergantung pada Kind yang dibuka saat peluncuran.

## Berkas relevan

- `src/app/program/page.tsx`
- `src/app/zakat/page.tsx`
- `src/app/akad-wakaf/[token]/`
- `src/lib/home/quickActionTiles.ts`
- `src/components/layout/Footer.tsx`
- halaman baru di `src/app/`

## Acceptance

- [ ] Landing wakaf, hibah, dan CSR terbit dengan salinan sesuai Kind yang dibuka (C7)
- [ ] Kategori wakaf mengikuti C9
- [ ] Tautan ke /program dari navigasi dan footer
- [ ] Halaman zakat punya CTA yang jelas
- [ ] Metadata SEO dan tes halaman; `sitemap` ikut diperbarui

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C): C7 dan C9 dijawab owner sesuai rekomendasi: saat peluncuran hanya Kind `donation` yang dibuka; kategori wakaf adalah empat kategori PRD. Akibat untuk salinan: landing wakaf, hibah, dan zakat tidak boleh mengajak orang berdonasi ke Campaign yang belum bisa ada (belum ada Kind Authorisation, mitra zakat, nazhir, atau review syariah hibah); salinan menjelaskan statusnya dan jalur Partnership Inquiry. Builder menandai di PR bila arah CTA zakat memerlukan keputusan salinan dari owner. `needs-info` menjadi `ready-for-agent`.
