# 58: Rate limit untuk login, register, donasi tamu, kirim ulang verifikasi, dan upload

**Type:** task (kode keamanan)

**Status:** ready-for-agent

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

- [ ] Login: percobaan ke-N+1 per klien+alamat dan per klien ditolak sebelum
      lookup/hash password
- [ ] Register: ditolak 429 di atas batas, sebelum body dibaca
- [ ] Donasi tamu: ditolak 429 di atas batas; Donor yang masuk tidak dihitung
- [ ] Kirim ulang verifikasi: 429 di atas batas; 503 dan tanpa email bila limiter
      gagal
- [ ] Upload: 429 di atas batas per akun; tanpa sesi tetap 401 tanpa menghitung
- [ ] Jalur fail-open tetap melayani saat limiter gagal
- [ ] Tanpa migrasi; tidak ada angka batas di `.scratch`

## Comments

- 2026-10-04: owner menyetujui rencana (H-1, Gelombang 0).
