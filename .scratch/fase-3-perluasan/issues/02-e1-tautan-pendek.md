# 02: E1 tautan-pendek

**Status:** ready-for-agent

**Blocked by:** none; E1 dijawab owner 2026-10-04

**Ukuran:** S, skema

**Catatan:** Skema: menyentuh `prisma/schema.prisma`/migrasi; satu PR skema pada satu waktu, timestamp migrasi dibagi koordinator.

**Prasyarat:** Domain atau prefix tautan pendek (skema).

**Keputusan (2026-10-04, ronde C):** E1 tautan pendek memakai prefix di domain apex, mis. `/s/<kode>` (tanpa domain terpisah).

## Latar

Tautan pendek per Campaign untuk dibagikan, supaya Traffic Source per tautan (PRD FFI-06) tidak memakai tautan panjang.

## Berkas relevan

- `docs/PRD-fund-for-indonesia.md:127` (FFI-06)
- .scratch/prd-audit/issues/12-campaign-share-not-wired.md
- `prisma/schema.prisma`

## Acceptance

- [x] Domain/prefix diputuskan dan dicatat di tiket: prefix di apex (mis. `/s/<kode>`), 2026-10-04
- [ ] Model tautan pendek + migrasi; pengalihan mencatat Traffic Source
- [ ] Tes route dan e2e

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Lajur E, relay kedua) dan `keputusan-ronde-c.md` (C23). Status `needs-info` karena grilling singkat dulu; acceptance di bawah sementara.

- 2026-10-04 (ronde C): E1 dijawab owner: prefix di apex, mis. `/s/<kode>`. Tidak ada pertanyaan terbuka; builder memilih bentuk persis prefix dan kode, memastikan tidak bentrok dengan rute yang ada (lihat tiket `32-route-slug-collision-guard`). `needs-info` menjadi `ready-for-agent`.
