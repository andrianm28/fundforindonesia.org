# 52: Event `paid` setelah Payment EXPIRED/FAILED diabaikan; createCharge sukses tetapi payment.create gagal tidak tercatat

**Type:** implementation (keamanan, kode uang)

**Status:** in-review

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02, `origin/main` 0f827b1)
menemukan dua skenario di mana uang tersimpan di payment provider tetapi tidak
ada jalur refund di aplikasi:

1. **Stray `paid` event**: Webhook menerima event `paid` untuk Payment yang sudah
   EXPIRED atau FAILED. Route mengabaikan dengan early exit
   (`src/app/api/webhooks/[provider]/route.ts:203-220`, comment "Already settled/failed/expired"):
   payment tidak di-update, uang tetap di provider, tidak ada notifikasi untuk refund.

2. **createCharge sukses, payment.create gagal**: Registrations route membuat charge
   di provider (`src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.ts:137-190`
   area `createCharge`). Jika `provider.createCharge` berhasil tetapi `payment.create`
   (Prisma write) gagal atau koneksi putus, uang sudah di provider tetapi tidak ada
   Payment record di database. Tidak ada cara untuk refund atau rekonsiliasi.

Aliran uang yang tidak tercatat: Provider terima pembayaran → DB tidak tercatat →
Tidak ada jalur refund → Dana hang indefinitely.

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
  dan tiga yang berarti uang mungkin menggantung dan butuh Admin:
  `AMOUNT_MISMATCH`, `SIBLING_ALREADY_PAID`, `UNKNOWN_PAYMENT`.
- **`ChargeWriteFailure`** (tabel baru): bila `createCharge` sukses tetapi
  `payment.create` gagal (registrations dan `chargeDonation`), baris dicatat
  dengan provider, ref, subjek, nominal, galat. Interface `PaymentProvider`
  belum punya `cancelCharge`, jadi pembatalan otomatis di provider tidak
  dilakukan; ini tindak lanjut yang sengaja ditinggalkan.

### Rekonsiliasi manual dana yang menggantung di provider

1. Daftar kerja Admin (SQL, belum ada UI):
   `SELECT * FROM "WebhookEvent" WHERE outcome IN ('AMOUNT_MISMATCH','SIBLING_ALREADY_PAID','UNKNOWN_PAYMENT') ORDER BY "receivedAt";`
   dan `SELECT * FROM "ChargeWriteFailure" WHERE "resolvedAt" IS NULL;`
2. `UNKNOWN_PAYMENT` yang `providerRef`-nya cocok dengan `ChargeWriteFailure`
   berarti charge yatim itu sudah dibayar: refund penuh di dashboard provider.
3. `ChargeWriteFailure` tanpa event `paid`: batalkan charge di provider.
4. Setelah selesai, isi `resolvedAt` dan `resolutionNote` pada barisnya.

Tes: `src/__tests__/integration/webhook-paid-after-expiry-real-db.test.ts`
(Postgres sungguhan: race, idempotensi, refund Trip Fee, mismatch, unknown),
plus kasus baru di `donation-charge.test.ts` dan test registrations route.
