# 52: Event `paid` setelah Payment EXPIRED/FAILED diabaikan; createCharge sukses tetapi payment.create gagal tidak tercatat

**Type:** implementation (keamanan, kode uang)

**Status:** awaiting-merge

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02) menemukan dua skenario di mana uang tersimpan di payment provider tetapi tidak ada jalur refund atau rekonsiliasi di aplikasi: (1) event `paid` untuk Payment yang sudah EXPIRED atau FAILED diabaikan, dan (2) charge sukses di provider tetapi pencatatan Payment gagal.

Detail teknis eksposur disimpan owner di luar repo publik; lihat PR #180 untuk perbaikan.

## Scope

Keadaan akhir (PR #180). Opsi yang tidak dipilih dihapus.

- **`paid` setelah Payment EXPIRED/FAILED disettle, bukan diabaikan.** Uangnya
  nyata di provider, jadi route memakai jalur Settlement biasa (guard
  `updateMany` berkunci pada status yang dibaca; indeks unik parsial
  `Payment_donationId_paid_key` tetap menjaga sibling). Donation menjadi
  `confirmed` dengan Receipt. Trip Fee yang kursinya sudah hilang (Registration
  EXPIRED/CANCELLED) di-refund penuh otomatis lewat `refundLateSettlement`
  (tiket 40/43); bila Registration-nya masih HOLD, kursinya dikonfirmasi.
  Keputusan owner 2026-10-02, lihat ADR 0021.
- **Sibling sudah settle:** event ditandai `SIBLING_ALREADY_PAID`, tidak
  dibukukan, dan Admin me-refund manual lewat runbook. Tidak ada refund
  otomatis sibling; itu opsi lanjutan yang menunggu keputusan owner (ADR 0021).
- **`WebhookEvent.outcome`** (kolom `String?`, tanpa enum Postgres) menamai tiap
  keputusan; nilainya di `WEBHOOK_OUTCOME` (`src/lib/money/payment-reconciliation.ts`):
  `SETTLED`, `PAID_AFTER_EXPIRED`, `PAID_AFTER_FAILED`, `LOST_RACE`,
  `IGNORED_TERMINAL`, serta empat yang berarti uang mungkin menggantung dan
  butuh Admin: `AMOUNT_MISMATCH`, `SIBLING_ALREADY_PAID`, `UNKNOWN_PAYMENT`,
  `LATE_SETTLEMENT_REFUND_FAILED` (Trip Fee sudah masuk ledger tetapi refund
  otomatisnya gagal, untuk Registration EXPIRED maupun CANCELLED; webhook tetap
  200). Cabang `failed`/`expired` yang kalah balapan (count 0) menulis `LOST_RACE`.
- **`ChargeWriteFailure`** (tabel baru): bila `createCharge` sukses tetapi
  `payment.create` gagal (registrations dan `chargeDonation`), baris dicatat
  dengan provider, ref, subjek, nominal, galat yang sudah disanitasi.
  `PaymentProvider` belum punya `cancelCharge`, jadi pembatalan otomatis di
  provider tidak dilakukan; tindak lanjut yang sengaja ditinggalkan.
- **Runbook:** [docs/runbooks/payment-reconciliation.md](../../../docs/runbooks/payment-reconciliation.md).

## Acceptance

- Tes: Webhook dengan event `paid` untuk Payment EXPIRED tidak di-ignore; di-settle
  dan diberi `outcome` untuk rekonsiliasi.
- Tes: Jika `payment.create` gagal setelah `createCharge`, kegagalannya tercatat
  sebagai `ChargeWriteFailure` untuk intervensi manual.
- Menyentuh kode uang di `src/app/api/webhooks/[provider]/route.ts` dan registrations:
  review independen `sonnet` wajib.

## Tes

`src/__tests__/integration/webhook-paid-after-expiry-real-db.test.ts` (Postgres
sungguhan: race, idempotensi, refund Trip Fee, sibling setelah expiry, mismatch,
unknown), kasus `ChargeWriteFailure` di `donation-charge.test.ts`, route
donations, route retry, dan route registrations, serta test webhook route.

## Comments

- 2026-10-02: keputusan owner (Dri): Donation yang dibayar setelah Payment EXPIRED/FAILED tetap di-settle, tidak di-refund; Trip Fee yang kursinya hilang tetap di-refund penuh. Dicatat di ADR 0021 dan CONTEXT.md.

- 2026-10-02: awaiting-merge. PR #180, commit 3b045ff. Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.
