# CSR dan Program

**Layar:** Admin > Program (`/admin/programs`, baru di `/admin/programs/baru`, ubah di `/admin/programs/[id]`); Admin > Partnership Inquiry (`/admin/partnership-inquiries`). Sisi perusahaan: `/akun/tim-csr` dan `/akun/tim-csr/gabung`.
**Siapa:** Admin (tim kemitraan).

**Program** adalah katalog kolaborasi CSR per Sektor yang dibaca tim CSR perusahaan. Program **tidak menerima uang daring**; kolaborasi berjalan lewat **Partnership Inquiry**.

## Mengelola Program

1. Buka **Program**; saring per sektor lewat `?sector=`.
2. **Baru**: pilih sektor, isi judul dan isi lain di formulir, simpan. **Ubah**: buka baris Program.
3. Program publik dibaca perusahaan di katalog CSR.

## Menindaklanjuti Partnership Inquiry

Inquiry datang dari formulir publik perusahaan atas satu Program. Tiap baris menampilkan Program, kontak yang disebut, status, dan siapa yang terakhir memindahkannya.

1. Status berjalan satu arah: **Belum ditindaklanjuti** menjadi **Ditindaklanjuti**, lalu **Selesai**. Tiap baris hanya menawarkan satu langkah maju; Inquiry Selesai tidak menawarkan apa pun.
2. Hubungi perusahaan lewat kontak yang tercantum (di luar platform), lalu tekan tombol langkah berikutnya.
3. Setelah menekan, daftar dimuat ulang dari database; bila Admin lain sudah memindahkannya lebih dulu, langkah Anda ditolak dan layar menampilkan keadaan terbaru.

## Hal yang perlu diwaspadai

- Notifikasi Inquiry baru dikirim ke `PARTNERSHIP_TEAM_EMAIL`. Bila tidak terisi atau email gagal, Inquiry **tetap tersimpan** dan kegagalan hanya tercatat di log: periksa antrean ini secara berkala, jangan hanya menunggu email ([runbooks/insiden.md](../runbooks/insiden.md)).
- Anggota tim CSR perusahaan mengelola keanggotaannya dari akun masing-masing; Admin tidak mengubahnya di sini.
- Data kontak perusahaan bersifat pribadi: jangan menyalinnya ke tiket, repo, atau catatan publik.
