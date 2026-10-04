# 80: M-d late-settlement-refund-surfacing

**Status:** ready-for-agent

**Blocked by:** none; C11 dijawab owner 2026-10-04

**Ukuran:** S-M

**Catatan:** Review uang/konkurensi: wajib review independen `sonnet` dengan bukti diposting di PR.

**Keputusan (2026-10-04, ronde C):** C11 settlement terlambat diusulkan sebagai Refund kepada Admin, tidak otomatis (sesuai rekomendasi).

## Latar

Settlement yang datang setelah pembayaran kedaluwarsa tercatat sebagai hasil webhook tetapi tidak muncul sebagai pekerjaan untuk Admin. Keputusan: diusulkan sebagai Refund, tidak otomatis.

## Berkas relevan

- `src/lib/money/payment-reconciliation.ts` (`lateSettlementOutcome` ~baris 82, `LATE_SETTLEMENT_REFUND_FAILED`)
- `src/lib/money/refunds.ts`
- `src/app/admin/refunds/new/`
- `src/app/admin/refunds/page.tsx`
- `.scratch/rilis-1-benda/issues/52-payment-event-paid-after-expiry-unhandled.md`, `43-sweep-for-refunds-stuck-after-late-settlement.md`

## Acceptance

- [ ] Pembayaran settle terlambat muncul di daftar Admin sebagai usulan Refund, dengan jumlah dan asalnya
- [ ] Admin membuat Refund dari usulan itu satu klik; tidak ada Refund otomatis
- [ ] Usulan yang sama tidak muncul dua kali setelah dibuatkan Refund
- [ ] Tes Postgres sungguhan; review independen `sonnet` diposting di PR

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C): C11 dijawab owner sesuai rekomendasi: usulan Refund kepada Admin, tidak otomatis. Untuk Trip Fee perilaku yang ada tetap (Refund otomatis, tiket 40 dan 43). `needs-info` menjadi `ready-for-agent`.
