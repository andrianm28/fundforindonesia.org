# 51: Webhook tidak memvalidasi kecocokan payment.provider dengan URL provider; jalur mock aktif di produksi

**Type:** implementation (keamanan)

**Status:** awaiting-merge

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02) menemukan dua celah pada webhook payment: (1) provider pada URL webhook tidak divalidasi terhadap provider yang tercatat pada Payment, dan (2) provider mock tidak cukup dijaga dari aktif di lingkungan produksi.

Detail teknis eksposur disimpan owner di luar repo publik; lihat PR #179 untuk perbaikan.

## Scope

- Update route webhook (`src/app/api/webhooks/[provider]/route.ts`):
  - Ekstrak `payment.provider` dari database setelah Payment ditemukan.
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
- Tes: provider mock ditolak atau diabaikan di lingkungan produksi.
- Dokumentasi: .env produksi tidak boleh menyertakan `MOCK_MIDTRANS_SERVER_KEY`.

## Keputusan implementasi

- **Mismatch**: `payment.provider !== event.provider` (event.provider = adapter
  yang memverifikasi, yaitu provider di URL) dicek di route tepat setelah
  `payment` ditemukan dan SEBELUM cek status terminal. Dijawab 200 `{ received: true }`,
  sama dengan `providerRef` tak dikenal, supaya mismatch bukan oracle keberadaan ref;
  hanya di-log (id, tanpa PII). WebhookEvent TIDAK diberi `processedAt`: kunci dedupe
  `(provider, providerEventId)` akan membuat event sah berikutnya dengan id sama
  dianggap replay. Baris itu dipungut event sah tadi. Payment, ledger, Registration,
  dan email tidak tersentuh.
- **Mock di produksi**: tiket ambigu (NODE_ENV test atau flag), jadi dipilih
  default aman. Builder `mock` di `src/lib/payments/index.ts` melempar
  `PaymentProviderNotConfiguredError` (webhook 503, tanpa tulisan apa pun) bila
  `NODE_ENV=production` kecuali `ALLOW_MOCK_PAYMENT_PROVIDER === 'true'` (string
  persis, seperti saklar lain). Adanya `MOCK_MIDTRANS_SERVER_KEY` saja tidak
  lagi cukup. Dev, vitest, dan e2e CI tidak terpengaruh (e2e berjalan di
  `next start` tetapi tidak memakai jalur mock dan tidak men-set key-nya; lihat
  komentar `ci.yml`).
- **Dokumentasi**: `.env.example` menyatakan .env produksi tidak boleh memuat
  `MOCK_MIDTRANS_SERVER_KEY` maupun `ALLOW_MOCK_PAYMENT_PROVIDER`;
  `docker-compose.prod.yml` tidak lagi mewajibkan `MOCK_MIDTRANS_SERVER_KEY`.
  `docker-compose.yml` (dev) dan smoke test `cd.yml` (hanya /api/health)
  dibiarkan.

## Comments

- 2026-10-02: awaiting-merge. PR #179, commit e2c9bd9. Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.
