# Operasional

**Layar:** Admin > Pengaturan Operasional (`/admin/operasional`); Admin > Penyedia Pembayaran (`/admin/payment-providers`). API: `/api/admin/operations`, `/api/admin/payment-providers`.
**Siapa:** Admin. Prosedur insiden lengkap: [runbooks/insiden.md](../runbooks/insiden.md).

Saklar darurat yang berlaku **saat itu juga, tanpa build ulang**.

## Menutup donasi

1. Matikan **Terima donasi**, klik **Simpan**.
2. Berhenti (503): pembuatan donasi, percobaan ulang pembayaran, dan pendaftaran Volunteer Trip berbayar. Halaman donasi langsung menampilkan pesan ditutup.
3. Tetap jalan: webhook penyedia (pembayaran yang sudah berjalan harus tetap tercatat).
4. Sebelum membuka lagi: jalankan [Rekonsiliasi](rekonsiliasi.md) dan pastikan seimbang.

## Mode pemeliharaan

1. Nyalakan **Mode pemeliharaan**, isi pesan bila perlu (maks. 500 karakter; kosong memakai pesan bawaan), **Simpan**.
2. Semua halaman publik menampilkan banner. Penulisan (`POST`, `PUT`, `PATCH`, `DELETE`) ke `/api/*` oleh selain Admin dijawab 503; membaca tetap jalan.
3. Tetap jalan: `/admin`, webhook, login, `/api/health`, pekerjaan terjadwal. Admin yang sedang masuk tetap bisa menulis.

## Riwayat perubahan

Bagian **Riwayat perubahan** menampilkan 50 perubahan terakhir: siapa, kapan (WIB), nilai lama dan baru.

## Penyedia Pembayaran

Satu formulir per penyedia terdaftar: nyalakan penyedia dan metodenya tanpa deploy. Penyedia yang kredensialnya tidak ada di lingkungan, atau tidak boleh menerima uang di produksi (mock, sandbox), ditampilkan dengan alasan dan **tanpa** cara menyalakannya. Kredensial tidak pernah diketik di sini ([konfigurasi-penyedia.md](../konfigurasi-penyedia.md)). Pilihan Admin mengalahkan `PAYMENT_PROVIDER`.

## Hal yang perlu diwaspadai

- Panel **hanya bisa menutup**: bila `NEXT_PUBLIC_DONATIONS_ENABLED` di lingkungan bukan `true`, donasi tetap tertutup dan layar menulis peringatannya.
- Mengosongkan `PAYMENT_PROVIDER` bukan cara menutup donasi.
- Bila pembacaan setelan gagal: mode pemeliharaan gagal **terbuka** (tidak menolak apa pun), saklar donasi gagal **tertutup**.
- Bila panel tidak terjangkau, hanya owner yang bisa menutup donasi lewat perubahan env dan build ulang.
