# 02: E1 tautan-pendek

**Status:** needs-info

**Blocked by:** none; menunggu C23 (E1) dan grilling

**Ukuran:** S, skema

**Catatan:** Skema: menyentuh `prisma/schema.prisma`/migrasi; satu PR skema pada satu waktu, timestamp migrasi dibagi koordinator.

**Prasyarat:** Domain atau prefix tautan pendek (skema).

**Menunggu keputusan:** C23 (E1). Domain atau prefix mana yang dipakai untuk tautan pendek? (rekomendasi tidak ada di rencana; owner menentukan)

## Latar

Tautan pendek per Campaign untuk dibagikan, supaya Traffic Source per tautan (PRD FFI-06) tidak memakai tautan panjang.

## Berkas relevan

- `docs/PRD-fund-for-indonesia.md:127` (FFI-06)
- .scratch/prd-audit/issues/12-campaign-share-not-wired.md
- `prisma/schema.prisma`

## Acceptance

- [ ] Domain/prefix diputuskan dan dicatat di tiket
- [ ] Model tautan pendek + migrasi; pengalihan mencatat Traffic Source
- [ ] Tes route dan e2e

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Lajur E, relay kedua) dan `keputusan-ronde-c.md` (C23). Status `needs-info` karena grilling singkat dulu; acceptance di bawah sementara.
