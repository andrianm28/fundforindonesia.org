# 13: Dokumentasi serah terima

**Blocked by:** 01 (isi runbook saklar)

**Status:** done

**What to build:** Pasal 19(1)–(2). (a) README.md teknis menggantikan boilerplate: arsitektur singkat, setup lokal, variabel env (rujuk .env.example), migrasi, test, CI, prosedur deploy (rujuk workflow + ops/deploy.sh), tanpa host/secret. (b) docs/runbooks/insiden.md: saklar donasi, mode pemeliharaan, webhook gagal, notifikasi gagal, restore, eskalasi (peran, bukan nama/nomor). (c) docs/panduan-admin/ satu file ringkas per modul panel (Campaign, moderasi, penyaluran, refund, rekonsiliasi, kategori, Laman Publik, pengguna, Partner Organisation, CSR, operasional). (d) docs/konfigurasi-penyedia.md: Sumopod, email SMTP, GlitchTip, backup. Ringkasan PDF panduan admin dibuat di luar repo.

- [x] Tidak ada host, IP, atau secret

## Comments

2026-11-09 (builder dokumentasi): selesai, hanya dokumen, tanpa perubahan kode.

- (a) `README.md` diganti dengan README teknis: platform dan operator, stack, peta repo, setup lokal, variabel env per kelompok (nama saja, rujuk `.env.example`), pengujian dan ratchet `ci/baselines.json`, CI/CD (`ci.yml`, `cd.yml`, `deploy.yml`), prosedur deploy dan rollback tanpa host.
- (b) `docs/runbooks/insiden.md` diperluas, tidak digandakan: webhook gagal (rujuk `payment-reconciliation.md`), notifikasi gagal (keadaan sekarang: kegagalan email hanya dicatat log sampai tiket 05 selesai), restore (rujuk `restore.md` dan `backup-dan-restore.md`), eskalasi menurut peran dengan tingkat Kritis 2 jam, Tinggi 4 jam, Normal 1 hari kerja (hari kerja 09.00 sampai 17.00 WIB).
- (c) `docs/panduan-admin/`: `README.md` (indeks, aturan dua orang) plus 14 file modul, diturunkan dari halaman di `src/app/admin`, `src/app/moderasi`, dan `src/app/akun`. Dicatat: menu Laporan Moderasi masih placeholder.
- (d) `docs/konfigurasi-penyedia.md`: Sumopod, SMTP, GlitchTip, Google login, backup, key enkripsi field; nama variabel saja.
- Semua path rute dan nama env yang disebut sudah dicek terhadap kode dan `.env.example`; tautan relatif dicek ada. Tidak ada host, IP, atau nilai rahasia. Ringkasan PDF panduan admin tetap di luar repo.
