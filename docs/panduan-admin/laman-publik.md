# Laman publik (Pengaturan Laman Publik)

**Layar:** Admin > Pengaturan Laman Publik (`/admin/site-settings`). API: `/api/admin/site-settings`.
**Siapa:** Admin.

Mengubah isi dan tautan yang tampil di laman publik tanpa deploy. Perubahan **langsung terlihat pengunjung**. Yang tampil adalah baris tersimpan, atau teks bawaan bila belum pernah diubah.

## Bagian yang bisa diubah

| Bagian | Isi |
| --- | --- |
| Banner beranda | Slide di atas beranda: gambar, judul, tombol |
| Kontak | Halaman Kontak: alamat, telepon, WhatsApp, NIB. Yang dikosongkan tidak ditampilkan |
| Media sosial | Tautan di footer dan halaman Kontak. Yang dikosongkan tidak ditampilkan |
| Footer | Paragraf pengantar di footer |
| Tentang Kami, Media, dan Karir | Isi halaman Tentang Kami dan email kontak halaman Media dan Karir |

## Langkah

1. Buka bagian yang ingin diubah. Di bawah judulnya tertulis siapa dan kapan terakhir mengubah (WIB), atau "Belum pernah diubah".
2. Ubah isian, lalu simpan **per bagian** (tiap bagian punya tombol sendiri).
3. Buka laman publik terkait untuk memastikan hasilnya.

## Hal yang perlu diwaspadai

- Alamat, telepon, dan NIB perusahaan sengaja kosong di kode; Admin mengisinya di sini. Isi dengan data resmi PT Jaya Korpora Prima, bukan contoh.
- Hanya konten publik. Penyedia pembayaran, fee, dan ambang punya layar sendiri ([biaya-escrow-ambang.md](biaya-escrow-ambang.md), [operasional.md](operasional.md)).
- Nama operator dan email resmi di Syarat dan Kebijakan Privasi berasal dari `src/lib/site-identity.ts` (perubahan lewat developer), bukan dari layar ini.
- Tidak ada pratinjau atau draf: simpan berarti terbit.
