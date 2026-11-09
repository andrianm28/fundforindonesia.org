# Kategori

**Layar:** Admin > Kategori (`/admin/kategori`). API: `/api/admin/categories`.
**Siapa:** Admin.

Kategori adalah daftar yang bisa dipilih Fundraiser saat membuat Campaign dan dipakai halaman Kategori publik.

## Langkah

1. Buka layar. Tiap baris menampilkan nama, slug, ikon, urutan, dan jumlah Campaign yang memakainya.
2. **Menambah**: isi nama, slug, ikon, dan urutan, lalu simpan.
3. **Mengubah nama, ikon, atau urutan**: edit pada barisnya. Urutan menentukan susunan di form dan halaman publik.
4. **Menghapus**: tombol Hapus (dengan konfirmasi) hanya ada untuk kategori yang tidak dipakai Campaign mana pun.

## Hal yang perlu diwaspadai

- **Slug tidak bisa diubah** setelah dibuat. Pilih dengan hati-hati: Campaign merujuk kategori lewat slug-nya.
- Kategori yang masih dipakai Campaign tidak bisa dihapus; ubah namanya bila yang diinginkan hanya penyegaran istilah.
- Kategori ikut menentukan override Platform Fee dan aturan transfer wakaf (Category yang sama), jadi jangan menggabung atau mengganti arti kategori yang sudah dipakai ([biaya-escrow-ambang.md](biaya-escrow-ambang.md)).
