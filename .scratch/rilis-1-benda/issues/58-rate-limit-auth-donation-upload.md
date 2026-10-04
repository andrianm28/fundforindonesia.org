# 58: Rate limit untuk login, register, donasi tamu, kirim ulang verifikasi, dan upload

**Type:** task (kode keamanan)

**Status:** awaiting-merge

**Blocked by:** none

## Konteks

Owner menyetujui rencana 2026-10-04 (item H-1). Mekanisme rate limit sudah ada
(`consumeRateLimit`, tabel `RateLimitBucket`, csr-06b) dan baru dipakai oleh
form Partnership Inquiry dan route anonimkan Receipt. Lima jalur publik atau
berisiko belum dibatasi: login, register, donasi tamu, kirim ulang email
verifikasi, dan upload.

## Yang dibangun

- Pembatasan pada kelima jalur, memakai `consumeRateLimit` dan scope baru per
  jalur. Tanpa migrasi, tanpa tabel baru.
- Kebijakan bila limiter sendiri gagal mengikuti pola yang ada: fail-open untuk
  jalur yang bila ditutup akan mengunci orang (login, register, donasi, upload);
  fail-closed (503) untuk jalur yang mengirim email (kirim ulang verifikasi).
- Angka batas ada di kode, bukan di `.scratch` (repo publik).
- Penolakan berupa 429 dengan `Retry-After`; login menolak lewat error
  credentials.

## Kriteria penerimaan

- [x] Login: percobaan ke-N+1 per klien+alamat dan per klien ditolak sebelum
      lookup/hash password
- [x] Register: ditolak 429 di atas batas, sebelum body dibaca
- [x] Donasi tamu: ditolak 429 di atas batas; Donor yang masuk tidak dihitung
- [x] Kirim ulang verifikasi: 429 di atas batas; 503 dan tanpa email bila limiter
      gagal
- [x] Upload: 429 di atas batas per akun; tanpa sesi tetap 401 tanpa menghitung
- [x] Jalur fail-open tetap melayani saat limiter gagal
- [x] Tanpa migrasi; tidak ada angka batas di `.scratch`

## Comments

- 2026-10-04: owner menyetujui rencana (H-1, Gelombang 0).
- 2026-10-04, branch `claude/rilis-1-58-rate-limit`: `src/lib/rate-limit-guard.ts`
  (`checkRateLimit`, `guardRoute`) membungkus `consumeRateLimit` dengan
  kebijakan per endpoint. Login dihitung di `authorize` (per klien+alamat dan per
  klien) sebelum lookup. Register per klien; donasi hanya tamu, per klien,
  setelah sesi dibaca; upload per akun setelah cek sesi; kirim ulang verifikasi
  per akun, fail-closed 503. Sisanya fail-open. Tes: `rate-limit-endpoints`,
  `auth.test`, `email-verification/route.test`. Ratchet lint 193, tsc 19.
  Catatan: route kirim ulang Receipt (cooldown sendiri) tidak termasuk cakupan.
  Commit kerja: 685d8bf.
