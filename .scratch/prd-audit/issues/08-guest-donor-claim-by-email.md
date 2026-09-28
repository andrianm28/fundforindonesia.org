# 08: Guest Donor claim-by-email dengan verifikasi tautan

**Type:** task

**Status:** open

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
