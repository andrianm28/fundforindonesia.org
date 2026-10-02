# 52: Event `paid` setelah Payment EXPIRED/FAILED diabaikan; createCharge sukses tetapi payment.create gagal tidak tercatat

**Type:** implementation (keamanan, kode uang)

**Status:** ready-for-agent

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

Dampak: dana bisa tertahan di provider tanpa catatan dan tanpa jalur refund.

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

## Comments

- 2026-10-02: ditriase retroaktif oleh koordinator (gap alur: builder di-dispatch saat masih needs-triage); owner menyetujui cakupan lewat "ya" 2026-10-02. Dibangun di PR #180.
