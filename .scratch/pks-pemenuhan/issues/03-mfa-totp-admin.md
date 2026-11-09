# 03: MFA TOTP untuk Admin dan Verifier

**Blocked by:** None (slot skema pertama)

**Status:** done

**What to build:** Login Admin saat ini cukup email + password (src/lib/auth.ts). Kontrak Pasal 8(1) mewajibkan autentikasi multifaktor untuk administrator. Bangun TOTP (RFC 6238, aplikasi authenticator) tanpa dependensi berbayar:

- Pendaftaran di /akun/keamanan: tampilkan secret + otpauth URI (QR), konfirmasi dengan satu kode, buat 10 kode cadangan sekali pakai (disimpan sebagai hash). Secret disimpan terenkripsi dengan field-encryption yang sudah ada.
- Pengguna yang memegang assignment ADMIN atau VERIFIER: setelah password benar, sesi berstatus 'perlu faktor kedua' sampai kode TOTP/cadangan valid; selama itu semua route /admin, /moderasi, dan API mereka 404 seperti non-pemegang. Pemegang yang belum mendaftar diarahkan ke pendaftaran sebelum bisa memakai panel (dengan masa tenggang yang bisa diatur env, default 0).
- Rate limit percobaan kode; jendela waktu ±1 langkah; kode yang sama tidak bisa dipakai dua kali.
- Admin lain bisa mereset MFA seorang pengguna (tercatat di audit).

- [x] Test unit TOTP terhadap vektor RFC 6238
- [x] Test: admin tanpa faktor kedua mendapat 404 di /admin dan /api/admin
- [x] Test: kode cadangan sekali pakai, replay ditolak, rate limit
- [x] Migrasi skema diuji terhadap DB berisi baris
- [ ] Review independen sonnet (keamanan)

## Comments

**Builder (2026-11-09):** Selesai, menunggu review independen (sonnet, keamanan).

- Desain: selama faktor kedua belum terpenuhi, `jwt` callback (src/lib/auth.ts) memberi token `assignments: []` (`src/lib/mfa-gate.ts`), jadi proxy, kedua layout, dan `withAssignmentCheck` menolak dengan 404 yang sama seperti non-pemegang tanpa satu pun dari mereka diubah. Sesi memegang `mfaState` (none/verified/grace/challenge/enroll).
- Cara sesi terpenuhi: rute `/api/account/mfa/{verify,confirm}` memeriksa kode lalu mengembalikan bukti HMAC berumur 2 menit yang terikat ke user + `sid` sesi + enrolment (`src/lib/mfa-proof.ts`); klien memberikannya ke `update({ mfaProof })` dan hanya callback `jwt` yang menerimanya. Data `update()` selain bukti diabaikan. Reset MFA oleh Admin lain atau pendaftaran ulang membatalkan bukti lama (terikat ke `enabledAt`).
- Skema: `UserMfa` (secret terenkripsi field-encryption, `lastUsedStep` untuk anti-replay), `MfaBackupCode` (bcrypt, `usedAt` lewat UPDATE bersyarat), `MfaAuditEntry`. Migrasi `20261109090000_mfa_totp`.
- Env baru `MFA_ENROLL_GRACE_DAYS` (default 0, dihitung dari `assignedAt` tertua). Job e2e CI mengisinya 36500 karena operator seed tidak punya aplikasi authenticator; produksi tidak boleh mengisinya kecuali owner memutuskan masa tenggang.
- Rate limit: 5 percobaan/5 menit per pengguna (`mfa-verify`), gagal-tutup bila limiter mati; pendaftaran 10/5 menit.
- Batasan yang diketahui: tidak ada QR (belum ada pustaka QR; halaman menampilkan secret base32 dan tautan otpauth). Cookie token yang basi di proxy (mis. setelah reset oleh Admin lain) baru diperbarui saat klien memuat `/api/auth/session`; layout dan API selalu membaca segar dan 404, tapi status HTTP layout bisa 200 dalam jendela itu (perilaku yang sudah ada untuk pencabutan assignment). Admin tunggal yang kehilangan perangkat dan kode cadangan harus direset lewat DB.
- Tes: totp (RFC 6238), mfa-gate, mfa-proof, auth-mfa (callback asli), mfa-second-factor-404 (rute/layout asli), rute akun & reset, halaman /akun/keamanan, login, proxy, real-DB (`mfa-real-db`, `mfa-totp-migration`; keduanya skip bila `TEST_DATABASE_URL` tidak diset).
