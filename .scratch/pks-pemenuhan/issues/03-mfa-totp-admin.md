# 03: MFA TOTP untuk Admin dan Verifier

**Blocked by:** None (slot skema pertama)

**Status:** wontfix

**What to build:** Login Admin saat ini cukup email + password (src/lib/auth.ts). Kontrak Pasal 8(1) mewajibkan autentikasi multifaktor untuk administrator. Bangun TOTP (RFC 6238, aplikasi authenticator) tanpa dependensi berbayar:

- Pendaftaran di /akun/keamanan: tampilkan secret + otpauth URI (QR), konfirmasi dengan satu kode, buat 10 kode cadangan sekali pakai (disimpan sebagai hash). Secret disimpan terenkripsi dengan field-encryption yang sudah ada.
- Pengguna yang memegang assignment ADMIN atau VERIFIER: setelah password benar, sesi berstatus 'perlu faktor kedua' sampai kode TOTP/cadangan valid; selama itu semua route /admin, /moderasi, dan API mereka 404 seperti non-pemegang. Pemegang yang belum mendaftar diarahkan ke pendaftaran sebelum bisa memakai panel (dengan masa tenggang yang bisa diatur env, default 0).
- Rate limit percobaan kode; jendela waktu ±1 langkah; kode yang sama tidak bisa dipakai dua kali.
- Admin lain bisa mereset MFA seorang pengguna (tercatat di audit).

- [ ] Test unit TOTP terhadap vektor RFC 6238
- [ ] Test: admin tanpa faktor kedua mendapat 404 di /admin dan /api/admin
- [ ] Test: kode cadangan sekali pakai, replay ditolak, rate limit
- [ ] Migrasi skema diuji terhadap DB berisi baris
- [ ] Review independen sonnet (keamanan)

## Comments

- 2026-11-09, keputusan owner: "takeout mfa cukup otp email". MFA TOTP yang sudah dibangun dicabut dari branch ini. Faktor kedua untuk Pasal 8(1) diganti login OTP email, yang dikerjakan di PR #330 (schema `LoginCode`). Sebelum serah terima, cek bahwa OTP email berlaku juga untuk Admin dan Verifier.
