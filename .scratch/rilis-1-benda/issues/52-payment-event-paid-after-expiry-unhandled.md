# 52: Event `paid` setelah Payment EXPIRED/FAILED diabaikan; createCharge sukses tetapi payment.create gagal tidak tercatat

**Type:** implementation (keamanan, kode uang)

**Status:** awaiting-merge

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02) menemukan dua skenario di mana uang tersimpan di payment provider tetapi tidak ada jalur refund atau rekonsiliasi di aplikasi: (1) event `paid` untuk Payment yang sudah EXPIRED atau FAILED diabaikan, dan (2) charge sukses di provider tetapi pencatatan Payment gagal.

Detail teknis eksposur disimpan owner di luar repo publik; lihat PR #180 untuk perbaikan.

## Scope

- **Stray `paid` event**:
  - Jangan abaikan early exit. Catat event sebagai `WebhookEvent` dengan status
    baru (misal: `UNHANDLED`, `EXPIRED_PAYMENT`, atau pilihan lain dengan owner).
  - Kirim notifikasi internal (log, alert) untuk manual refund/reconciliation.
  
- **createCharge sukses, payment.create gagal**:
  - Gunakan atomic transaction: `provider.createCharge` harus di dalam database
    transaction yang sama dengan `payment.create`, atau rollback charge di provider
    jika payment write gagal.
  - Alternatif: catch error setelah `createCharge`, charge `provider.cancelCharge`
    atau refund jika fail.
  - Catat error dengan reference nomor untuk rekonsiliasi manual.

- Dokumentasi: alur refund/reconciliation untuk dana yang hang di provider.

## Acceptance

- Tes: Webhook dengan event `paid` untuk Payment EXPIRED tidak di-ignore; dikurasi
  untuk reconciliation.
- Tes: Jika `payment.create` gagal setelah `createCharge`, charge di-cancel atau
  di-refund otomatis; jika tidak bisa, error-nya tercatat untuk manual intervention.
- Menyentuh kode uang di `src/app/api/webhooks/[provider]/route.ts` dan registrations:
  review independen `sonnet` wajib.

## Implementasi (in-review)

Keputusan yang diambil builder (owner dapat membalik):

- **`paid` setelah EXPIRED/FAILED disettle, bukan diabaikan.** Uangnya nyata di
  provider, jadi route memakai jalur Settlement biasa (guard `updateMany`
  berkunci pada status yang dibaca; indeks unik parsial
  `Payment_donationId_paid_key` tetap menjaga sibling). Donation menjadi
  `confirmed` dengan Receipt; Trip Fee yang kursinya sudah hilang (Registration
  EXPIRED/CANCELLED) otomatis di-refund penuh lewat `refundLateSettlement`
  (tiket 40/43). Ledger selalu terisi.
- **`WebhookEvent.outcome`** (kolom baru) menamai tiap keputusan; nilainya di
  `WEBHOOK_OUTCOME` (`src/lib/money/payment-reconciliation.ts`): `SETTLED`,
  `PAID_AFTER_EXPIRED`, `PAID_AFTER_FAILED`, `LOST_RACE`, `IGNORED_TERMINAL`,
  dan empat yang berarti uang mungkin menggantung dan butuh Admin:
  `AMOUNT_MISMATCH`, `SIBLING_ALREADY_PAID`, `UNKNOWN_PAYMENT`, dan
  `PAID_AFTER_EXPIRY_REFUND_FAILED` (Trip Fee sudah masuk ledger tetapi refund
  otomatisnya gagal; webhook tetap 200). Kolom `outcome` bertipe `String`,
  bukan enum Postgres, jadi nilai baru ini tidak memerlukan migrasi.
- **`ChargeWriteFailure`** (tabel baru): bila `createCharge` sukses tetapi
  `payment.create` gagal (registrations dan `chargeDonation`), baris dicatat
  dengan provider, ref, subjek, nominal, galat. Interface `PaymentProvider`
  belum punya `cancelCharge`, jadi pembatalan otomatis di provider tidak
  dilakukan; ini tindak lanjut yang sengaja ditinggalkan.

### Rekonsiliasi manual dana yang menggantung di provider

1. Daftar kerja Admin (SQL, belum ada UI):
   `SELECT * FROM "WebhookEvent" WHERE outcome IN ('AMOUNT_MISMATCH','SIBLING_ALREADY_PAID','UNKNOWN_PAYMENT','PAID_AFTER_EXPIRY_REFUND_FAILED') ORDER BY "receivedAt";`
   dan `SELECT * FROM "ChargeWriteFailure" WHERE "resolvedAt" IS NULL;`
2. `UNKNOWN_PAYMENT` yang `providerRef`-nya cocok dengan `ChargeWriteFailure`
   berarti charge yatim itu sudah dibayar: refund penuh di dashboard provider.
3. `ChargeWriteFailure` tanpa event `paid`: batalkan charge di provider.
4. `PAID_AFTER_EXPIRY_REFUND_FAILED`: sweep refund yang sudah ada
   (`sweepStuckLateSettlementRefunds`, tiket 43) memilih Payment PAID tanpa
   Refund pada Registration EXPIRED/CANCELLED, jadi kasus ini diulang otomatis
   (teruji di integrasi). Bila baris event masih ada setelah satu putaran sweep,
   buat Refund penuh manual (`createRefund`) dan catat di dashboard provider.
5. Setelah selesai, isi `resolvedAt` dan `resolutionNote` pada barisnya.

Tes: `src/__tests__/integration/webhook-paid-after-expiry-real-db.test.ts`
(Postgres sungguhan: race, idempotensi, refund Trip Fee, mismatch, unknown),
plus kasus baru di `donation-charge.test.ts` dan test registrations route.

## Comments

- 2026-10-02: keputusan owner (Dri): Donation yang dibayar setelah Payment EXPIRED/FAILED tetap di-settle, tidak di-refund; Trip Fee yang kursinya hilang tetap di-refund penuh. Dicatat di ADR 0021 dan CONTEXT.md.

- 2026-10-02: awaiting-merge. PR #180, commit 3b045ff. Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.
