# 06: E5 automatic-settlement-import

**Status:** needs-info

**Blocked by:** 85 (M-c xendit-adapter)

**Ukuran:** M-L

**Catatan:** Review uang/konkurensi kemungkinan diperlukan; tentukan saat grilling.

**Prasyarat:** Setelah M-c (penyedia kedua).

**Menunggu:** M-c (85) selesai, lalu grilling singkat (rencana tidak punya pertanyaan C23 untuk E5). Keputusan owner 2026-10-04 (ronde C): E5 dikerjakan setelah M-c.

## Latar

Impor settlement otomatis dari penyedia pembayaran. Bergantung pada adapter Xendit (dan pola Sumopod) karena format fee/settlement per penyedia.

## Berkas relevan

- .scratch/rilis-1-benda/issues/85-xendit-adapter.md
- `plan.md` Lajur X dan Lajur E
- `src/lib/payments/`

## Acceptance

- [ ] Sumber settlement per penyedia dan format diputuskan saat grilling
- [ ] Impor idempoten dan tercatat; selisih masuk antrean rekonsiliasi
- [ ] Tes dan e2e

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Lajur E, relay kedua) dan `keputusan-ronde-c.md` (C23). Status `needs-info` karena grilling singkat dulu; acceptance di bawah sementara.

- 2026-10-04 (ronde C): E5 dijawab owner: dikerjakan **setelah M-c** (tiket 85). Status tetap `needs-info` (grilling singkat sumber settlement per penyedia menunggu M-c); pemblokirnya 85.
