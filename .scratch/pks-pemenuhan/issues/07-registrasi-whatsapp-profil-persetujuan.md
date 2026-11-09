# 07: Registrasi: WhatsApp, profil individu/lembaga, persetujuan tersimpan

**Blocked by:** 05 (slot skema)

**Status:** done

**What to build:** Pasal 3.1: form daftar dan pengaturan profil menerima nomor WhatsApp (opsional, divalidasi format Indonesia, disimpan di `phoneCiphertext` yang sudah ada), pilihan jenis profil Individu/Lembaga (kolom baru; Lembaga tetap perlu didaftarkan Verifier sebagai Partner Organisation), dan dua centang wajib Syarat Layanan + Kebijakan Privasi. Simpan catatan persetujuan (versi dokumen, waktu) per pengguna. Login Google juga harus melewati persetujuan pada login pertama.

- [ ] Test: daftar tanpa centang ditolak di API
- [ ] Test: persetujuan tersimpan dengan versi + waktu
- [ ] Test: WhatsApp tersimpan terenkripsi dan bisa diubah di pengaturan

## Comments

2026-11-11, builder (sonnet), migrasi `20261111070000_registrasi_profil_persetujuan`.

- Skema: `User.profileType` (enum `ProfileType`, default INDIVIDUAL), model `UserConsent` (`userId`, `document` TERMS|PRIVACY, `version`, `acceptedAt`; unik per pengguna+dokumen+versi, cascade). Aditif; `prisma migrate diff` kosong terhadap DB yang sudah dimigrasi.
- WhatsApp: opsional, dinormalkan `628...` (`src/lib/whatsapp.ts`), disimpan lewat `sealUserPhone` ke `phoneCiphertext/phoneKeyId` (ADR 0012, tanpa kolom polos). Dibaca lewat `GET /api/user/profile` (pemilik saja); diubah/dikosongkan lewat `PATCH /api/user/profile` dan bagian "Kontak dan Jenis Profil" di /akun/pengaturan.
- Persetujuan: `acceptTerms` + `acceptPrivacy` (literal true) wajib di `POST /api/auth/register`; baris `UserConsent` ditulis bersarang dalam `user.create` (satu penulisan dengan akun). Mekanisme login tidak disentuh; sandi tetap seperti sekarang.
- Google: `GET/POST /api/user/consent` + `ConsentGate` di AppShell mengarahkan akun ber-`Account` penyedia tanpa catatan versi sekarang ke `/akun/persetujuan`. Gerbang ini sisi klien dan hanya menahan pencatatan, bukan akses uang.
- Keputusan terbuka untuk owner: (1) akun password lama tanpa catatan tidak ditahan; (2) akun yang lahir dari login OTP (PR #330) tidak punya `Account`, jadi jalur OTP harus menulis persetujuan sendiri atau definisi "pending" diganti menjadi "tanpa catatan sama sekali"; (3) menaikkan `LEGAL_DOCS_VERSION` belum memicu persetujuan ulang.
- Tidak ada env var baru; allowlist properti tidak perlu diubah (tidak ada halaman/API Admin baru).
