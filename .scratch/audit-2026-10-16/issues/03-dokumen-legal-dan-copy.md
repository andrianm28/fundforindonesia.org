# 03: Dokumen legal dan copy publik (audit hukum L2, L3, L4, L6, L7, L8, L10)

**Type:** task

**Status:** done

**Blocked by:** (tidak ada)

## Ruang lingkup

Temuan di audit hukum 2026-10-16 yang hanya menyentuh teks, tautan, dan runbook; tanpa perubahan skema.

- **L2** Syarat & Ketentuan, Kebijakan Privasi, dan Footer menyebut operator **PT Jaya Korpora Prima** (ADR 0009); Kebijakan Privasi menyebutnya Pengendali Data Pribadi. Satu konstanta di `src/lib/site-identity.ts` (nama operator, email umum, email privasi, tanggal revisi) dipakai Terms, Privacy, Footer, Kontak, dan sebagai bawaan `DEFAULT_SITE_SETTINGS`. Bagian baru Terms: Lembaga Mitra yang tertera pada Kampanye adalah pihak lawan Donatur di bawah izin penghimpunannya sendiri (ADR 0010). Tanggal revisi 16 Oktober 2026.
- **L8** Telepon, WhatsApp, jam layanan, dan alamat palsu dihapus (bawaan kosong; halaman Kontak menyembunyikan bagian yang kosong). Email: `halo@fundforindonesia.org` (umum), `privasi@fundforindonesia.org` (hak data pribadi). Akun media sosial sudah seragam dengan footer (`fundforindonesia`).
- **L6** Terms, FAQ, Help: biaya "ditampilkan di halaman setiap Campaign" (tanpa 5%); matriks pengembalian dana per Kind (ADR 0007, ADR 0013); QRIS satu-satunya metode; dana ditahan lalu disalurkan lewat Pencairan Dana; peninjauan oleh Verifier manusia. Catatan pra-bayar HIBAH di `DonationConfirmation` (prop `hibahNotice`).
- **L7** Klaim "jutaan orang", "terpercaya", "standar transparansi tertinggi" dihapus dari Footer, Register, Tentang Kami (bawaan), dan metadata.
- **L3 (bagian non-skema)** Baris persetujuan dengan tautan di bawah form Daftar dan Masuk. Tautan Terms/Privacy di mobile: baris kecil di halaman Akun (footer hanya tampil di desktop).
- **L4 (koreksi faktual)** Klaim NIK/KTP dihapus; pemroses disebut (Sumopod, penyedia layanan email, Google); kategori data ditambah (donatur tamu, rekening bank, Volunteer Trip, CSR, doa); retensi data keuangan 10 tahun (PRD FFI-16); janji "hapus 30 hari" diganti ajukan lewat email + anonimisasi (ADR 0023).
- **L10** Langkah 0 "Prasyarat hukum" di `docs/runbooks/beta-ke-live.md`.

## Belum dikerjakan (tiket terpisah)

- **Tinjauan penasihat hukum** atas Terms dan Privacy, termasuk isi UU PDP penuh (dasar pemrosesan, transfer lintas negara, pemberitahuan kebocoran 3x24 jam, DPO, anak di bawah umur) dan klausul usia 17 tahun.
- **Kolom persetujuan** (`termsAcceptedAt`, versi Terms/Privacy) pada User dan Donation tamu, termasuk persetujuan saat donasi tamu dan login Google pertama: perubahan skema, PR tersendiri.
- **Data dari owner:** konfirmasi bahwa kotak surat `.org` di atas aktif. NIB, alamat kantor, dan telepon/WhatsApp dibiarkan kosong (owner 2026-10-29); Admin mengisinya lewat Pengaturan Laman Publik, dan halaman Kontak menyembunyikan yang kosong.
- L1, L5, L9, L11, L12, L13 tidak disentuh.

## Verifikasi

Tes halaman terkait (`legal-pages.test.tsx`, Footer, Akun, Login, Register, DonationConfirmation, Kontak, site-settings), `tsc --noEmit`, eslint pada berkas yang berubah.

## Comments
