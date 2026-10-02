# 56: Webhook pembayaran dan resend Receipt menjawab 500 (skalar di dalam `include`)

**Type:** bug (ditulis retroaktif)

**Status:** awaiting-merge

**Blocked by:** none

## Konteks

Commit enkripsi kontak `4e55f3b` menyebarkan `...SELECT_DONATION_GUEST_EMAIL`
(dua kolom skalar: `guestEmailCiphertext`, `guestEmailKeyId`) ke dalam
`include` pada query Donation di `src/app/api/webhooks/[provider]/route.ts` dan
`src/app/api/receipts/[token]/resend/route.ts`. Prisma menolak skalar di dalam
`include`, sehingga **setiap webhook pembayaran, dari provider mana pun,
menjawab 500**: Payment tidak pernah PAID dan Registration Trip Fee tidak
pernah CONFIRMED. Resend Receipt untuk tamu gagal dengan sebab yang sama.
Ditemukan UAT lokal 2026-10-02. Tes lama memakai mock Prisma yang tidak pernah
memvalidasi query, sehingga bug lolos. Kode uang: harus merge sebelum deploy
apa pun dari `main`.

## Cakupan

- Hapus spread skalar dari `include` di kedua route (dengan `include`, skalar
  ikut otomatis, jadi ciphertext dan key id email tamu tetap tersedia untuk
  Receipt).
- Audit pola `...SELECT_*`: hanya dua tempat di atas yang berada di dalam
  `include`; sisanya di `select` yang valid.
- Tes integrasi dengan Postgres sungguhan yang memanggil handler route asli.
- Guard statis yang menolak spread `...SELECT_*` di dalam `include`.

## Kriteria penerimaan

- [x] Webhook `settlement` untuk Donation biasa menjawab 200 dan Payment menjadi PAID.
- [x] Webhook untuk Donation tamu dengan email terenkripsi menjawab 200; Receipt dikirim ke alamat hasil dekripsi.
- [x] Webhook untuk Registration Trip Fee menjawab 200 dan Registration menjadi CONFIRMED.
- [x] Resend Receipt untuk tamu berhasil, juga untuk donor akun.
- [x] Event yang sama dikirim dua kali menjawab 200 keduanya, satu Receipt, email tidak terkirim dua kali (idempotensi).
- [x] Guard statis gagal bila ada spread `...SELECT_*` di dalam `include`.
- [x] Tes terbukti menangkap bug: dengan kedua route dikembalikan ke versi `main`, tes integrasi gagal.
- [x] Review independen `sonnet` (jalur uang): bisa merge, tanpa temuan blocking; should-fix idempotensi dan nit resend donor serta guard statis sudah dikerjakan.
- [x] Ratchet di baseline (lint 193, tsc 47); `next build` lulus.

## Tes yang membuktikan

- `src/__tests__/integration/webhook-settlement-real-db.test.ts` (Postgres
  sungguhan lewat `TEST_DATABASE_URL`; hanya `@/lib/mail` di-mock).
- `src/__tests__/no-select-spread-in-include.test.ts` (guard statis).
- Route webhooks dan receipts, serta `contact-fields.test.ts`: 71 tes lulus.

## Comments

- 2026-10-02: tiket ditulis retroaktif oleh koordinator; pekerjaan dibangun sebelum tiket ada (gap alur). PR #171, commit 9d7f5f1.
