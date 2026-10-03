# 08: Guest Donor claim-by-email dengan verifikasi tautan

**Type:** task

**Status:** done (PR #186, 7aed972)

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
  - [ ] Hanya user login dengan email terverifikasi yang bisa meminta tautan;
        permintaan dibatasi rate limit yang sudah ada
  - [ ] Token disimpan sebagai hash, sekali pakai, kedaluwarsa 24 jam; token
        kedaluwarsa, terpakai, atau milik user lain ditolak tanpa mengubah apa pun
  - [ ] Klaim menautkan Donation Guest yang cocok ke akun dalam satu transaksi
        dan idempoten; Donation ber-akun, teranonimkan, atau key id lama tidak disentuh
  - [ ] Riwayat Donasi akun menampilkan Donation yang sudah diklaim
  - [ ] Tes di seam route dan satu tes Postgres sungguhan

- 2026-10-03 (owner memilih menutup): klaim sudah berjalan sejak prd-compliance 23 (PR #186). Saat email akun terverifikasi lewat tautan konfirmasi, Donation Guest dengan HMAC email yang sama ditautkan ke akun (`src/lib/guest-donation-claim.ts`). Tautan konfirmasi itu sudah membuktikan kepemilikan email, jadi jalur tautan kedua tidak dibuat; branch `claude/prd-audit-08-guest-claim-by-email` tidak di-merge.
