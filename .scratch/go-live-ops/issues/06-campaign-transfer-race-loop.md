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

- 2026-10-30: loop dijalankan di cloud session (4 vCPU) terhadap Postgres lokal, `TEST_DATABASE_URL` diset sehingga tes benar-benar berjalan (log tiap run dicek: tidak ada `skipped`). `src/__tests__/integration/campaign-transfer-real-db.test.ts` (11 tes, termasuk dua approve dari satu sumber, A→B vs B→A tanpa deadlock, dan transfer vs Refund) dijalankan **50 kali berturut-turut: 50 lulus, 0 gagal**. Selama loop, tiga builder lain menjalankan vitest berkas terkait di container yang sama, jadi loop ini juga berjalan di bawah kontensi CPU; tidak ada full suite yang berjalan bersamaan. Tidak ada kegagalan, jadi tidak ada perubahan domain. Satu run ~2,4 detik untuk 11 tes.
