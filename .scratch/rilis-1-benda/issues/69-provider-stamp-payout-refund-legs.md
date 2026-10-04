# 69: M-b provider-stamp-payout-refund-legs

**Status:** ready-for-agent

**Blocked by:** none

**Ukuran:** M

**Catatan:** Review uang/konkurensi: wajib review independen `sonnet` dengan bukti diposting di PR.

## Latar

Kaki jurnal Payout dan Refund belum diberi penanda penyedia, sehingga `providerBalances` memasukkannya ke bucket tak terselesaikan dan `perProviderIsExact` tidak bisa benar bila ada dua penyedia. Wajib sebelum M-c.

## Berkas relevan

- `src/lib/money/ledger.ts` (opsi `provider` baris ~53)
- `src/lib/money/payouts.ts`
- `src/lib/money/refunds.ts`
- `src/lib/money/provider-withdrawals.ts` (`reconcileProviderBalances`)
- `src/app/api/admin/reconcile/route.ts`

## Acceptance

- [ ] Setiap kaki jurnal Payout dan Refund baru memuat penyedia yang memprosesnya
- [ ] `reconcileProviderBalances` menempatkan kaki itu di bucket penyedianya; baris lama tetap di bucket tak ber-penyedia dan tidak dimigrasi diam-diam
- [ ] `perProviderIsExact` benar untuk skenario dua penyedia dalam tes
- [ ] Tes Postgres sungguhan untuk Payout dan Refund; hukum konservasi tetap
- [ ] Review independen `sonnet` diposting di PR

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
