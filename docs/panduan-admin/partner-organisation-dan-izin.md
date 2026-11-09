# Partner Organisation dan izin

**Layar:** Moderasi > Partner Organisation (`/moderasi/partner-organisations`), Collecting Entity (`/moderasi/collecting-entities`), Kind Authorisation (`/moderasi/kind-authorisations`), Rekening (`/moderasi/rekening`); Admin > Collecting Entity (`/admin/collecting-entities`).
**Siapa:** Verifier mendaftarkan dan memverifikasi. Admin dan Verifier sama-sama boleh menetapkan Collecting Entity pada Campaign Active yang belum punya.

## Mendaftarkan Partner Organisation

1. Di **Partner Organisation**, daftarkan organisasi bersama akun Fundraiser yang bertindak atas namanya (akun utama, pemiliknya). Periksa dokumen legalnya lebih dulu.
2. Atur apakah organisasi **bersedia menaungi** Campaign Fundraiser perorangan.
3. **Catat izin** (Fundraising Permit): nomor, penerbit, Kind yang dicakup, masa berlaku. Campaign hanya bisa dibuka bila Collecting Entity memegang izin yang berlaku untuk Kind-nya.
4. Untuk wakaf atau hibah, berikan **Kind Authorisation** (izin bertanggal). Perpanjang dengan memindahkan tanggal akhir (**Perpanjang sampai**). Koreksi izin yang salah pada baris izinnya.
5. Halaman **Kind Authorisation** menampilkan izin yang habis dalam 30 hari atau sudah lewat; saat lewat, Campaign Kind itu berhenti menerima donasi sampai diperpanjang.

## Anggota tim organisasi

Pemilik organisasi mengundang anggota (peran lihat-saja) dari `/akun/organisasi`; undangan dikirim lewat email dan diterima di `/akun/organisasi/terima`. Bila email gagal terkirim, layar akun menulis "Undangan dibuat, tetapi email belum terkirim": cabut dan undang lagi.

## Verifikasi rekening tujuan

1. Buka **Rekening**: antrean rekening yang diajukan pemiliknya. Nomor lengkap hanya dirender di server pada layar ini.
2. **Loloskan** atau **Tolak**. Pemilik rekening sendiri tidak boleh memutuskan rekeningnya.
3. **Cabut Verifikasi** bila rekening bermasalah, **Pulihkan Verifikasi** bila pencabutan keliru. Rekening tidak bisa diedit: salah nomor berarti hapus lalu tambah ulang.

## Hal yang perlu diwaspadai

- Tidak ada yang dihapus; setiap perubahan tercatat di audit server.
- Platform Operator tidak pernah menjadi Collecting Entity; selalu sebuah Partner Organisation.
- Campaign tanpa Collecting Entity atau tanpa izin berlaku tidak menerima donasi, walau statusnya Active.
