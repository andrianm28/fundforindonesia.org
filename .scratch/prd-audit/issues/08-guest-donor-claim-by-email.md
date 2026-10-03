# 08: Guest Donor claim-by-email dengan verifikasi tautan

**Type:** task

**Status:** awaiting-merge

**Blocked by:** —

## Why

FFI-13 minta Guest Donor bisa melihat riwayat Donation-nya lintas-akun lewat
verifikasi tautan email; alurnya tidak ada di kode. Dampak kecil hari ini
(user login hanya melihat Donation atas `userId`-nya sendiri). Owner
2026-09-28 (`triage-2026-09-28.md` Bagian A, Q2): masuk Rilis 1, dikerjakan
sebelum Rilis 1 selesai tapi **tidak memblokir Soft Launch** -- ini fitur
akun, bukan jalur uang.

## Question

Bentuk verifikasi tautan (kedaluwarsa, sekali pakai atau berulang), dan
bagaimana Donation Guest Donor sebelum akun dibuat direkonsiliasi dengan
akunnya setelah verifikasi.

## Comments

- 2026-10-03 (keputusan owner, menjawab Question): **tautan sekali pakai,
  kedaluwarsa 24 jam.** User yang login meminta tautan ke email akunnya
  (email akun harus sudah terverifikasi). Saat tautan dibuka, semua Donation
  Guest yang emailnya sama dengan email akun ditautkan ke akun itu. Pencocokan
  memakai `guestEmailHmac` (bukan plaintext; kolom plaintext sudah tidak ada).
  Donation yang disegel dengan key id HMAC lama tidak ikut, sama dengan
  batasan anonimisasi di prd-compliance 48. Donation yang sudah ber-akun atau
  sudah dianonimkan tidak disentuh.

  Acceptance:
  - [x] Hanya user login dengan email terverifikasi yang bisa meminta tautan;
        permintaan dibatasi rate limit yang sudah ada
  - [x] Token disimpan sebagai hash, sekali pakai, kedaluwarsa 24 jam; token
        kedaluwarsa, terpakai, atau milik user lain ditolak tanpa mengubah apa pun
  - [x] Klaim menautkan Donation Guest yang cocok ke akun dalam satu transaksi
        dan idempoten; Donation ber-akun, teranonimkan, atau key id lama tidak disentuh
  - [x] Riwayat Donasi akun menampilkan Donation yang sudah diklaim
  - [x] Tes di seam route dan satu tes Postgres sungguhan

- 2026-10-03 (builder, branch `claude/prd-audit-08-guest-claim-by-email`):
  tabel baru `GuestClaimToken` (migrasi `20261003040000`; hash SHA-256, simpan
  `emailHmac` + `emailHmacKeyId` saat terbit, tanpa email). `POST
  /api/user/guest-claim` (sesi, email terverifikasi, rate limit 3/jam per akun
  lewat `consumeRateLimit`, fail-closed 503 karena membatasi surat keluar) dan
  `POST /api/user/guest-claim/confirm` (wajib sesi akun yang sama dengan
  pemilik token). Konfirmasi = satu transaksi: spend token, cek akun masih
  punya hmac + key id yang sama dan terverifikasi, lalu
  `claimGuestDonations(userId, tx)` (kini menerima klien transaksi). Penolakan
  apa pun me-rollback, jadi token tetap utuh. Halaman `/akun/klaim-donasi`
  (tombol, bukan auto-spend) dan prompt di Donasi Saya. Catatan untuk owner:
  `GET /api/donations/mine` dan konfirmasi email (prd-compliance 23) sudah
  auto-klaim untuk akun terverifikasi tanpa tautan; tidak diubah di tiket ini,
  jadi tautan ini jalur eksplisit tambahan.
