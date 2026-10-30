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
- 2026-10-30: dikerjakan (builder, branch `claude/project-thread-dcqhpw-t69`). `payouts.ts`: kaki instructed distempel `provider` yang dibaca saat approve; kaki completed dan failed-reversal memakai `payout.approvedProvider` (null pada Payout lama -> tetap tak ber-penyedia, tidak dimigrasi). `refunds.ts`: kaki freeze, approved, paid, dan reject/fail-reversal memakai `payment.provider`; kaki `refund-reversal-release` (ESCROW_HOLD, tidak menyentuh GATEWAY_CLEARING) sengaja tidak distempel. Tanpa perubahan skema; `reconcileProviderBalances`/route tidak diubah (sudah membaca bucket per penyedia). Tes baru `src/__tests__/integration/provider-stamp-payout-refund-real-db.test.ts` (Postgres sungguhan, dua penyedia). Review independen `sonnet` dan PR belum.
- 2026-10-30 (revisi review): teks usang di `reconcile/route.ts`, `provider-withdrawals.ts`, `ledger.ts` diperbarui (hanya baris sebelum tiket 69 dan Payout lama tanpa `approvedProvider` yang tak ber-penyedia). Tes dua penyedia ditulis ulang terisolasi (angka hard-coded); ditambah tes reversal reject Refund. Catatan: Refund yang di-freeze/approve sebelum perubahan ini lalu dibayar sesudahnya mengkredit pot bernama (benar secara fisik; freeze/approve tidak menyentuh GATEWAY_CLEARING). Tindak lanjut: komentar `LedgerEntry.provider` di `prisma/schema.prisma` masih menyebut Payout/Refund tanpa penyedia; ubah saat slot skema bebas (komentar saja, tanpa migrasi).
