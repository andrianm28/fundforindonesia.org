# Pemenuhan PKS Release 1: Platform Galang Dana

**Status:** ready-for-agent

## Latar

Owner meminta seluruh kewajiban PKS (kontrak pengembangan dengan YIEM, Release 1) dipenuhi sebelum serah terima. Analisa pasal demi pasal ada di file proyek `riset/analisa-kepatuhan-pks-2026-11-09.md` (bukan di repo; teks kontrak memuat data pribadi para pihak dan tidak boleh di-commit). Spec ini hanya mencatat celah yang bisa ditutup di kode repo ini, dengan nomor pasal sebagai rujukan.

Modul yang kontrak kelaskan BERSYARAT (zakat, CSR pipeline 8 status, donasi rutin, Aamiin anti-ganda + beranda kurasi, kotak masuk) **ikut dikerjakan**: owner memutuskan 2026-11-09 lewat kartu keputusan ("Kerjakan semua modul Bersyarat"). Tiket 15–19. Zakat dibangun di balik penanda fitur yang default mati (Pasal 12 ayat 2).

## Prinsip

- Jangan melonggarkan jalur uang yang sudah ada. Gerbang baru selalu menambah syarat, tidak mengganti.
- Setelan operasional (saklar donasi, mode pemeliharaan, preset nominal) disimpan sebagai baris `SiteSetting` dengan modul sendiri, terpisah dari Pengaturan Laman Publik, dan hanya bisa diubah Admin.
- Satu PR skema pada satu waktu (urutan tiket di bawah).
- Kode uang/keamanan mendapat review independen `sonnet` sebelum merge.

## Tiket

| No | Judul | Pasal | Kelas | Skema |
|---|---|---|---|---|
| 01 | Saklar donasi dari panel + mode pemeliharaan | 8(2), 12(3), 12(5), 19 | WAJIB | tidak |
| 02 | Preset nominal donasi diatur Admin | 4.6 | INTI | tidak |
| 03 | MFA TOTP untuk Admin dan Verifier | 8(1) | WAJIB | ya |
| 04 | Tag entitas di jurnal + rekonsiliasi per entitas | 4.1(2), 4.3, 4.4 | WAJIB | ya |
| 05 | Antrean notifikasi gagal, tandai-selesai webhook, email error ke Admin | 4.2, 8(2) | WAJIB | ya |
| 06 | Halaman publik profil lembaga + nomor izin | 12(5) | INTI | tidak |
| 07 | Registrasi: WhatsApp, profil individu/lembaga, persetujuan S&K/Privasi tersimpan | 3.1, 3.8 | INTI | ya |
| 08 | Data verifikasi penggalang dana | 3.2 | INTI | ya |
| 09 | Kampanye: galeri, pernyataan kebenaran data, label status, riwayat status | 3.3, 3.4 | INTI | ya |
| 10 | Publik: pengurutan katalog, donatur teratas, moderasi doa | 3.7 | INTI | ya |
| 11 | Donatur dan penggalang: unduh bukti, kampanye didukung, ringkasan nominal | 3.8, 3.9 | INTI | tidak |
| 12 | Penyaluran: minta revisi, dokumen pendukung, catatan | 4.5 | INTI | ya |
| 13 | Dokumentasi serah terima: README, runbook insiden, panduan admin per modul | 19 | INTI | tidak |
| 14 | Enkripsi berkas dokumen privat saat disimpan | 7(1), 8(1), 10(4) | WAJIB | tidak |
| 15 | Aamiin anti-ganda + beranda kurasi manual | 3.7(5)-(6) | BERSYARAT | ya |
| 16 | Kotak masuk: notifikasi status pembayaran | 3.10 | BERSYARAT | tidak |
| 17 | Modul kolaborasi CSR lengkap | 3.6 | BERSYARAT | ya |
| 18 | Donasi rutin lewat payment link per siklus | 4.7 | BERSYARAT | ya |
| 19 | Modul zakat di balik penanda fitur | 3.5, 12(2) | BERSYARAT | ya |
