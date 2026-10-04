# 06: H-7 campaign-transfer-race-loop

**Status:** ready-for-agent

**Blocked by:** none

**Ukuran:** S

**Catatan:** Kualitas tes konkurensi uang; jalankan satu vitest pada satu waktu karena CPU 4 vCPU (AGENTS.md).

## Latar

Tes race Postgres sungguhan untuk `campaign-transfer` harus terbukti stabil, bukan lolos sekali kebetulan.

## Berkas relevan

- `src/lib/money/campaign-transfers.ts`
- `src/lib/money/campaign-transfers.test.ts`
- `src/__tests__/integration/`

## Acceptance

- [ ] Tes race `campaign-transfer` dijalankan dalam loop (jumlah iterasi tercatat di Comments) tanpa satu pun kegagalan
- [ ] Bila ada kegagalan: akar masalah ditemukan dan diperbaiki di domain, bukan dengan menaikkan timeout
- [ ] Loop tidak berjalan bersamaan dengan full suite lain
- [ ] Hasil dilaporkan dengan angka

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
