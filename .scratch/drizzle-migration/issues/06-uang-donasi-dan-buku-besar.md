# 06: Uang I, donasi dan buku besar

**Blocked by:** 04, 05

**Status:** needs-triage

- [ ] `src/lib/money/ledger.ts`, `donation-charge`, `create-charged-donation`, `counted-payment`, webhook `api/webhooks/[provider]`, `payment-reconciliation`.
- [ ] Batas transaksi, tingkat isolasi, `FOR UPDATE`, advisory lock, dan raw SQL identik; rupiah tetap `number` dari kolom `integer`.
- [ ] Semua tes DB-asli uang (webhook settlement, konkurensi) hijau dengan `TEST_DATABASE_URL`.
- [ ] Review independen `sonnet`; eskalasi `opus` bila menemukan pelanggaran berat.
