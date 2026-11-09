# CSR dan Program

**Layar:** Admin > Program (`/admin/programs`, baru di `/admin/programs/baru`, ubah di `/admin/programs/[id]`); Admin > Partnership Inquiry (`/admin/partnership-inquiries`). Sisi perusahaan: `/akun/tim-csr` dan `/akun/tim-csr/gabung`.
**Siapa:** Admin (tim kemitraan).

**Program** adalah katalog kolaborasi CSR per Sektor yang dibaca tim CSR perusahaan. Program **tidak menerima uang daring**; kolaborasi berjalan lewat **Partnership Inquiry**.

## Mengelola Program

1. Buka **Program**; saring per sektor lewat `?sector=`.
2. **Baru**: pilih sektor, isi judul dan isi lain di formulir, simpan. **Ubah**: buka baris Program.
3. Program publik dibaca perusahaan di katalog CSR.

## Menindaklanjuti Partnership Inquiry

Inquiry datang dari formulir publik perusahaan atau dari akun Tim CSR atas satu Program. Halaman ini berupa **pipeline**: satu kolom per tahap (Baru, Dihubungi, Proposal, Negosiasi, Disetujui, Berjalan, Selesai, Tidak dilanjutkan), dan tiap Inquiry berupa kartu berisi Program, narahubung, kisaran anggaran, periode, tanda proposal terlampir, dan PIC.

1. Tekan **Kelola** pada kartu untuk membuka rincian: kontak, alamat dan NPWP perusahaan (hanya Admin yang melihatnya), kebutuhan, proposal PDF (tautan, dibuka lewat akses privat), dan riwayat perubahan beserta catatannya.
2. Ubah **Tahap**, pilih **PIC** (hanya pengguna Admin), dan tulis **Catatan tindak lanjut**, lalu **Simpan perubahan**. Satu simpanan menjadi satu entri riwayat (siapa, kapan, apa yang berubah).
3. Tahap boleh dipindah maju atau mundur kapan saja. Satu pengecualian: memindahkan Inquiry **keluar dari Selesai atau Tidak dilanjutkan** wajib disertai alasan di catatan.
4. Setelah menyimpan, pipeline dan rincian dimuat ulang dari database; bila Admin lain sudah mengubahnya lebih dulu, perubahan Anda ditolak dan layar menampilkan keadaan terbaru.

Inquiry lama dipetakan saat migrasi: Belum ditindaklanjuti menjadi Baru, Ditindaklanjuti menjadi Dihubungi, Selesai tetap Selesai.

## Hal yang perlu diwaspadai

- Notifikasi Inquiry baru dikirim ke `PARTNERSHIP_TEAM_EMAIL`. Bila tidak terisi atau email gagal, Inquiry **tetap tersimpan** dan kegagalan hanya tercatat di log: periksa antrean ini secara berkala, jangan hanya menunggu email ([runbooks/insiden.md](../runbooks/insiden.md)).
- Anggota tim CSR perusahaan mengelola keanggotaannya dari akun masing-masing; Admin tidak mengubahnya di sini.
- Data kontak perusahaan bersifat pribadi: jangan menyalinnya ke tiket, repo, atau catatan publik.
