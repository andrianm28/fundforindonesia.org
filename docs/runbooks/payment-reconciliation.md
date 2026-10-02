# Runbook: rekonsiliasi pembayaran yang menggantung di provider

Dipakai Admin bila uang ada di payment provider tetapi tidak ada pencatatan atau refund yang cocok di aplikasi. Asal: tiket 52 (`.scratch/rilis-1-benda/issues/52-payment-event-paid-after-expiry-unhandled.md`), keputusan di [ADR 0021](../adr/0021-donation-paid-after-expiry-still-settles.md). Belum ada UI; semuanya lewat SQL dan dashboard provider.

## Daftar kerja

```sql
SELECT * FROM "WebhookEvent"
WHERE outcome IN ('AMOUNT_MISMATCH','SIBLING_ALREADY_PAID','UNKNOWN_PAYMENT','LATE_SETTLEMENT_REFUND_FAILED')
ORDER BY "receivedAt";

SELECT * FROM "ChargeWriteFailure" WHERE "resolvedAt" IS NULL;
```

Daftar outcome yang butuh Admin ada di `WEBHOOK_OUTCOMES_NEEDING_REVIEW` (`src/lib/money/payment-reconciliation.ts`).

## Per kasus

1. `UNKNOWN_PAYMENT` yang `providerRef`-nya cocok dengan `ChargeWriteFailure`: charge yatim itu sudah dibayar. Refund penuh di dashboard provider.
2. `ChargeWriteFailure` tanpa event `paid`: batalkan charge di provider (interface `PaymentProvider` belum punya `cancelCharge`).
3. `SIBLING_ALREADY_PAID`: Payment Donation lain pada Donation yang sama sudah settle, jadi event ini tidak dibukukan. Tidak ada refund otomatis. Admin me-refund penuh uang Payment ini di dashboard provider, lalu mencatatnya.
4. `AMOUNT_MISMATCH`: tidak ada yang dibukukan. Cocokkan nominal dengan provider, lalu putuskan refund atau koreksi manual.
5. `LATE_SETTLEMENT_REFUND_FAILED`: Trip Fee sudah masuk ledger, tetapi refund otomatis untuk Registration yang kursinya hilang (EXPIRED atau CANCELLED) gagal. Sweep `sweepStuckLateSettlementRefunds` (tiket 43) mengulanginya otomatis. Bila baris event masih ada setelah satu putaran sweep, buat Refund penuh manual (`createRefund`) dan catat di dashboard provider.
6. Setelah selesai, isi `resolvedAt` dan `resolutionNote` pada barisnya.
