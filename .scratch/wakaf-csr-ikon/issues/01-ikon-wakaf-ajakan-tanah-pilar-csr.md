# 01: Kartu ikon Wakaf, ajakan wakaf tanah, dan pilar Kolaborasi CSR

**Latar:** Permintaan Mba Ira (pemilik platform), diteruskan owner 2026-10-16.

**Blocked by:** none

**Status:** done (PR #274)

- [x] `/wakaf`: empat kategori (Masjid, Sekolah, Fasilitas Kesehatan, Fasilitas Umum) tampil sebagai kartu ikon, bukan daftar teks
- [x] `/wakaf`: ajakan wakaf tanah dengan salinan Ira apa adanya, tombol "Ajukan Wakaf Tanah Anda" dan "Konsultasi Wakaf Tanah"
- [x] Kedua tombol tidak menuju pembayaran: Ajukan membuka email ke alamat kontak Pengaturan Situs dengan templat data tanah; Konsultasi membuka WhatsApp kontak (email bila WhatsApp kosong)
- [x] Kotak status tetap menyatakan wakaf belum dibuka untuk uang; ditambah kalimat bahwa pengajuan wakaf tanah dicatat dan ditindaklanjuti bersama nazhir berizin
- [x] `/kolaborasi-csr`: empat pilar (Sector) sebagai kartu ikon dengan cakupan dari deck (PRD §8) dan tautan ke bagian Sector di `/program`
- [x] Tanpa perubahan skema; tidak menyentuh berkas PR #265

## Comments

2026-10-16 (builder): Pilar CSR diambil dari empat Sector (CONTEXT.md, PRD §8 "Portofolio sektor CSR"), karena repo tidak mencatat pilar yayasan lain. Owner diminta mengonfirmasi. Screenshot sebelum/sesudah di `screenshots/`.

2026-10-29 (builder): Owner mengonfirmasi empat pilar CSR dan menyetujui merge.
