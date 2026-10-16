# Pengaturan Laman Publik

**Status:** in review (draft PR)
**Diminta owner:** 2026-10-16, "semua konfigurasi di laman publik bisa diatur oleh admin di panel admin".

## Audit (2026-10-16)

Sebelum perubahan ini, isi laman publik yang ditulis langsung di kode:

| Isi | Lokasi | Sekarang |
| --- | --- | --- |
| Slide banner beranda (gambar, judul, tombol) | `src/app/page.tsx` | bisa diatur (`hero`) |
| Email, telepon, WhatsApp, jam layanan, alamat | `(static)/contact` | bisa diatur (`contact`) |
| Tautan Instagram, Twitter, Facebook | `Footer.tsx`, `(static)/contact` | bisa diatur (`social`) |
| Paragraf "Tentang" di footer | `Footer.tsx` | bisa diatur (`footer`) |
| Isi Tentang Kami, email Media, email Karir | `(static)/about`, `press`, `careers` | bisa diatur (`pages`) |

Sudah bisa diatur Admin sebelumnya, tidak disentuh: Penyedia Pembayaran, Platform Fee,
Ambang Penyalahgunaan. Konfigurasi uang dan rahasia sengaja di luar cakupan.

## Belum ikut (keputusan owner diperlukan)

- Ubin aksi cepat di beranda (`src/lib/home/quickActionTiles.ts`): tiap ubin terikat pada
  kesiapan modul (Kolaborasi CSR, Wakaf, Hibah masih "segera"), jadi sengaja tetap kode.
- Teks panjang berstruktur: Help Center, FAQ, Syarat & Ketentuan, Kebijakan Privasi,
  Impact. Dua yang terakhir adalah teks hukum; mengubahnya tanpa versi/jejak perubahan
  berisiko. Perlu keputusan apakah ingin editor teks kaya dan riwayat versi.
- Gambar banner: Admin mengisi path atau URL https; belum ada unggah file.

## Desain

- Tabel `SiteSetting` (satu baris per bagian, `value` JSON, `updatedById`, `updatedAt`).
  Migrasi aditif, tanpa backfill; tanpa baris, laman menampilkan teks bawaan (sama seperti
  ambang yang belum diatur).
- `src/lib/site-settings.ts`: skema zod per bagian, bawaan, `resolveSiteSettings`,
  `setSiteSetting`. Tautan hanya `https://` atau path `/...`.
- `POST /api/admin/site-settings` (ADMIN), halaman `/admin/site-settings`.
- Database tak terjangkau: laman publik jatuh ke teks bawaan, tidak error.
