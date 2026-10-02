# 51: Webhook tidak memvalidasi kecocokan payment.provider dengan URL provider; jalur mock aktif di produksi

**Type:** implementation (keamanan)

**Status:** ready-for-agent

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02, `origin/main` 0f827b1)
menemukan dua celah pada webhook payment:

1. **Provider mismatch**: Route `/api/webhooks/[provider]` menerima URL parameter
   `[provider]` tetapi tidak memvalidasi bahwa `event.provider` dalam body payload
   cocok dengan `[provider]` di URL (`src/app/api/webhooks/[provider]/route.ts:171`, `:393`).
   Webhook yang tidak cocok dengan provider pembayaran sebenarnya bisa diterima.

2. **Mock provider aktif di produksi**: Jalur `/api/webhooks/mock` aktif selama
   `MOCK_MIDTRANS_SERVER_KEY` ada di lingkungan (`src/lib/payments/index.ts:73`).
   Jika konfigurasi ini terbawa ke produksi, jalur mock yang tanpa verifikasi
   signature ikut aktif.

## Scope

- Update route webhook di `src/app/api/webhooks/[provider]/route.ts`:
  - Ekstrak `payment.provider` dari database (setelah `findUnique`, baris 171).
  - Bandingkan `payment.provider === [provider]` (dari URL). Jika tidak cocok, tolak
    dengan 400 atau 404.
  
- Update `src/lib/payments/index.ts`:
  - Pastikan `mock` provider hanya dapat digunakan jika `NODE_ENV === 'test'` atau
    environment flag khusus (bukan `MOCK_MIDTRANS_SERVER_KEY` yang mudah terlupakan).
  - Atau hapus provider mock dari production build sama sekali.
  - Minimal: dokumentasikan bahwa `MOCK_MIDTRANS_SERVER_KEY` harus tidak ada di `.env`
    produksi.

## Acceptance

- Tes: Webhook dengan `[provider]` di URL tidak cocok dengan `payment.provider` di
  database ditolak dengan 400/404.
- Tes: Webhook ke `/api/webhooks/mock` ditolak atau diabaikan di lingkungan non-test.
- Dokumentasi: .env produksi tidak boleh menyertakan `MOCK_MIDTRANS_SERVER_KEY`.

## Comments

- 2026-10-02: ditriase retroaktif oleh koordinator (gap alur: builder di-dispatch saat masih needs-triage); owner menyetujui cakupan lewat "ya" 2026-10-02. Dibangun di PR #179.
