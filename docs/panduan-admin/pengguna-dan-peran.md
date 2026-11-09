# Pengguna dan peran

**Layar:** Admin > Manajemen Pengguna (`/admin/users`). API: `/api/admin/users`.
**Siapa:** Admin.

Layar ini mengatur **penugasan** (Verifier, Admin). Penugasan adalah satu-satunya sumber kekuasaan; peran akun biasa tidak memberi wewenang apa pun ([ADR 0005](../adr/0005-roles-are-separate-assignments-not-a-hierarchy.md)). Satu orang boleh memegang keduanya.

## Memberi atau mencabut Verifier

1. Cari pengguna di daftar (berhalaman).
2. Centang **Verifier** untuk memberi, hapus centang untuk mencabut. Berlaku seketika dan tercatat di jejak audit.

## Memberi Admin (dua Admin)

1. **Admin A** mencentang **Admin** pada pengguna. Ini **tidak langsung memberi**: terbuka permintaan, kotak tetap tidak tercentang.
2. Permintaan muncul di **Menunggu konfirmasi grant ADMIN**. **Admin B** (bukan A, bukan penerima) menekan **Konfirmasi**. Pengaju dapat menarik kembali permintaannya.
3. Jejak audit mencatat Diajukan, Diberikan, atau Dicabut beserta pelaku dan waktunya.

## Mencabut Admin

Hapus centang **Admin**; pencabutan berlaku seketika. Server menolak mencabut **penugasan milik sendiri** (jenis apa pun) dan menolak mencabut **Admin terakhir**.

## Hal yang perlu diwaspadai

- Beri peran sesedikit mungkin, dan cabut segera saat orang berpindah tugas.
- Admin dan Verifier tidak bertindak atas Campaign, Trip, atau rekening miliknya sendiri; punya dua penugasan tidak menghapus batas itu.
- Alamat email di daftar didekripsi hanya untuk tampilan panel; jangan disalin keluar sistem.
- Sebelum mencabut Admin, pastikan masih ada minimal dua Admin supaya aturan dua orang (Payout, Refund, dst.) tetap bisa dijalankan.
- Bila akses panel hilang total, eskalasi lewat [runbooks/insiden.md](../runbooks/insiden.md).
