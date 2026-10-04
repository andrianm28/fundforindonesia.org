# Catatan integrasi Sumopod

Rujukan teknis untuk adapter Sumopod di bawah antarmuka `PaymentProvider`. Ditulis 19 September 2026 dari dashboard Sumopod proyek "Galang Dana YIEM", yang akunnya dipegang Platform Operator. Semua kredensial disimpan sebagai environment variable dan tidak pernah masuk repositori.

## Lingkungan

| Hal | Nilai |
| --- | --- |
| Base URL sandbox | `https://api-pay-sandbox.sumopod.com/api/v1` |
| Base URL produksi | Belum dikonfirmasi, tanyakan ke Sumopod sebelum rilis |
| Autentikasi | Header `X-Api-Key` |
| Environment variable | `SUMOPOD_API_KEY`, `SUMOPOD_WEBHOOK_SECRET`, `SUMOPOD_BASE_URL` |

## Metode pembayaran dan biaya

| Kode | Biaya | Settlement |
| --- | --- | --- |
| `QRIS` | 0,7 persen + Rp300 | T+2 |
| `QRIS_INSTANT` | 1,5 persen + Rp300 | T+0 |

Biaya ini adalah Provider Fee dan ditanggung Campaign. Sumopod mengembalikan `fee` dan `net_amount` baik pada pembuatan Payment maupun pada webhook, jadi adapter tidak pernah menghitung sendiri.

Default platform adalah `QRIS`. Karena Escrow Hold dihitung sejak `settled_at`, `QRIS_INSTANT` memajukan titik mulai Escrow Hold dua hari, jadi dana tersedia dua hari lebih cepat. Harganya 0,8 persen dari setiap donasi. Pada Campaign biasa percepatan itu tidak sepadan; `QRIS_INSTANT` disediakan sebagai pilihan Admin untuk Campaign bencana, di mana dua hari benar-benar berarti.

Komponen Rp300 membuat biaya relatif jauh lebih berat pada donasi kecil: Rp440 atas Rp20.000 adalah 2,2 persen, sedangkan Rp7.300 atas Rp1 juta hanya 0,73 persen. Karena itu minimum donasi Rp20.000 dan Platform Fee dibebaskan di bawah Rp50.000.

## Membuat Payment

`POST /payments` dengan `order_id`, `amount`, `currency: "IDR"`, `expires_in_hours` (opsional, default dan maksimum 24), `success_return_url`, `cancel_return_url`, dan `payment_method_type_code`.

Respons memuat `payment_id`, `order_id`, `amount`, `fee`, `net_amount`, `payment_link_url`, `payment_code`, `payment_code_type`, `payment_channel_used`, `status`, dan `expires_at`.

Pemetaan ke model kita:

| Sumopod | Kita |
| --- | --- |
| `order_id` | id Donation, konvensi yang sudah dipakai sejak M4 |
| `payment_id` | `Payment.providerRef` |
| `payment_link_url` | `ChargeResult.redirectUrl` pada varian `qris_redirect` |
| `fee` | `Payment.providerFee`, menggantikan nilai nol yang sekarang dipaku di rute webhook |
| `expires_at` | `ChargeResult.expiresAt`, maksimal 24 jam ke depan |

## Webhook

Empat event: `payment.completed`, `payment.failed`, `payment.expired`, dan `payment.test`. Payload memuat `event_type` dan `data` dengan `payment_id`, `order_id`, `amount`, `fee`, `net_amount`, `status`, `payment_method`, `paid_at`, `settled_at`, dan `completed_at`.

Pemetaan status ke `WebhookEvent.status`: `payment.completed` menjadi `paid`, `payment.failed` menjadi `failed`, `payment.expired` menjadi `expired`. Event `payment.test` dijawab 200 dan tidak menyentuh basis data. Event `payment.expired` menutup Donation, dan Donor bisa membuat Payment baru atas Donation yang sama lewat tombol coba bayar lagi.

Tiga hal yang mengikat implementasi:

1. **Tanda tangan.** Header `svix-id`, `svix-timestamp`, dan `svix-signature`. Secret berawalan `whsec_`, bagian setelah awalan adalah base64. Konten yang ditandatangani adalah `{svix-id}.{svix-timestamp}.{raw body}` dengan HMAC SHA-256, hasilnya base64. Header bisa memuat beberapa tanda tangan dipisah spasi selama sekitar 24 jam setelah rotasi, jadi bandingkan terhadap semuanya. Wajib memakai badan permintaan mentah; satu spasi yang berubah membatalkan kecocokan. Header `X-Webhook-Token` tersedia sebagai alternatif sederhana, tetapi adapter memakai tanda tangan karena token statis tidak mengikat isi maupun waktu.
2. **Batas waktu.** Endpoint wajib menjawab 2xx dalam 10 detik, jika tidak webhook ditandai gagal dan dikirim ulang dari dashboard. Pekerjaan berat tidak boleh berada di jalur permintaan.
3. **Idempotensi.** Pengiriman ulang dari dashboard adalah hal biasa. Kunci unik `WebhookEvent` yang sudah ada memakai pasangan penyedia dan id event; untuk Sumopod id event diambil dari header `svix-id`.

Payload tidak memuat nilai `fee` yang ditandatangani terpisah, tetapi seluruh badan permintaan tercakup tanda tangan, jadi `fee` dan `amount` di dalamnya boleh dipercaya setelah verifikasi. Pemeriksaan silang `amount` terhadap `Payment.amount` yang sudah ada tetap dijalankan.

## Waktu dan Escrow

Sumopod membedakan `paid_at`, saat Donor membayar, dari `settled_at`, perkiraan saat dana masuk saldo yang bisa ditarik, yaitu T+2 untuk `QRIS`. Field `completed_at` sama dengan `settled_at` dan hanya ada demi kompatibilitas.

Kode sekarang memakai waktu server sebagai `paidAt` dan menghitung Escrow Hold darinya. Adapter harus memakai `paid_at` dari payload sebagai `Payment.paidAt` dan menyimpan `settled_at` tersendiri.

Escrow Hold dihitung dari `settled_at`, bukan dari `paid_at`. Escrow Hold ada untuk memberi ruang Refund dan margin atas keterlambatan settlement, bukan untuk membuktikan dana sudah masuk: `settled_at` hanyalah perkiraan penyedia dan tanpa API saldo sistem tidak bisa memverifikasinya. Tujuh hari sejak perkiraan T+2 memberi margin lima hari, dan Admin tetap wajib memeriksa saldo nyata di dashboard sebelum menyetujui Payout. Pada penyedia dengan settlement lambat, penghitungan dari `paid_at` akan melepas dana yang belum masuk. `paid_at` dipakai untuk tampilan dan metrik waktu donasi. Penyedia yang tidak memberi perkiraan settlement diperlakukan sebagai T+0 dan angkanya dicatat di adapter, bukan ditebak di lapisan escrow.

**Keputusan owner, 2026-09-27:** pada webhook Sumopod yang tanda tangannya valid tetapi `settled_at`-nya hilang atau tidak valid, fallback-nya adalah `paid_at` + T+2 (perkiraan settlement QRIS Sumopod di atas), bukan T+0, karena Escrow Hold tidak boleh memendek hanya karena data hilang.

## Pencairan

Sumopod tidak punya API disbursement. Alurnya: Fundraiser mengajukan Payout, satu Admin menyetujui sehingga jurnal instruksi terbit, lalu Admin yang berbeda masuk ke dashboard Sumopod, menarik dana langsung ke rekening Fundraiser, kembali ke panel, dan menandai Payout selesai dengan bukti transfer. Dua orang berbeda itu wajib, bukan anjuran. Refund menempuh jalur manual yang sama. Tidak ada panggilan penyedia dalam alur ini, sehingga aturan dua orang dan bukti wajib adalah satu-satunya pengendali.

Dana yang belum ditarik berada di saldo Sumopod atas nama Platform Operator, bukan di rekening penghimpunan. Buku besar mencatatnya sebagai akun saldo penyedia agar selisih terhadap rekening bank selalu terlihat di laporan rekonsiliasi.

## Sudah dikonfirmasi ke Sumopod, 19 September 2026

- **Hanya QRIS.** Tidak ada virtual account, e-wallet, maupun kartu. Contoh respons yang memuat `payment_channel_used` bernilai `BRI.VA` hanyalah contoh generik dokumentasi, bukan kanal yang tersedia untuk proyek ini.
- **Tidak ada API** untuk URL base produksi yang terdokumentasi, untuk membaca saldo dan riwayat penarikan, maupun untuk batas nominal per Payment. Ketiganya hanya ada di dashboard.

Dua akibat yang harus diterima sampai penyedia kedua aktif:

1. Donor yang tidak bisa memindai QRIS tidak punya cara membayar. Tidak ada jalur cadangan, dan ini pembatas nyata pada konversi Fase 1.
2. Rekonsiliasi harian sepenuhnya manual. Admin membuka dashboard Sumopod, membaca saldo dan riwayat penarikan dengan mata, lalu mencocokkannya dengan laporan internal dan mencatat hasilnya. Impor otomatis baru mungkin pada penyedia yang punya API-nya.

## Ketidakcocokan yang harus dibereskan sebelum adapter jalan

URL webhook di dashboard menunjuk ke `https://api.fundforindonesia.org/payments/webhook/sumopod`, sedangkan aplikasi ini melayani webhook di `/api/webhooks/{provider}` pada domain aplikasi.

Keputusan: ubah URL di dashboard menjadi `https://fundforindonesia.org/api/webhooks/sumopod`. Proksi di subdomain ditolak karena tanda tangan svix dihitung atas badan permintaan mentah, dan proksi yang memformat ulang satu karakter saja akan membuat setiap webhook gagal verifikasi.

**Riwayat 19 September 2026:** URL diubah, tombol Save & Test menjawab `401 {"error":"Invalid signature"}`. Itu perilaku yang benar: rute menolak event yang tidak bisa diverifikasi, karena saat itu `getPaymentProvider()` mengabaikan parameter penyedia pada URL dan selalu memakai adapter tiruan bergaya Midtrans.

**Sudah dikerjakan.** Adapter Sumopod kini ada, dan keempat hal berikut sudah terpasang:

1. **Registry memilih adapter dari parameter URL.** `getPaymentProvider(name?)` memetakan `sumopod` dan `mock` ke adapter masing-masing, tidak peduli huruf besar kecil. Nama yang tidak dikenal kini ditolak dengan `UnknownPaymentProviderError` dan rute menjawab 404, bukan diam-diam jatuh ke Midtrans. Tanpa argumen, registry memakai `PAYMENT_PROVIDER` dan default `mock`, yang dipakai jalur donasi dan payout.
2. **Badan permintaan mentah.** Adapter membaca `request.text()`, memverifikasi, baru mem-parsing. Ada tes yang menandatangani badan ber-spasi yang tidak akan direproduksi `JSON.stringify`, sehingga adapter yang diam-diam round-trip akan ketahuan.
3. **Pemetaan event.** `payment.completed` ke `paid`, `payment.failed` ke `failed`, `payment.expired` ke `expired`, sisanya termasuk `payment.test` ke status baru `ignored`, yang dijawab 200 tanpa menulis apa pun. `providerEventId` diambil dari `svix-id`.
4. **Provider Fee nyata.** Rute memakai `event.providerFee ?? 0`, dan adapter mengisinya dari `fee` di payload.

Dua pengerasan yang ikut masuk dan tidak ada di dokumentasi Sumopod:

- **Jendela anti-replay lima menit** atas `svix-timestamp`, mengikuti pustaka resmi svix. Payload yang benar tetap benar selamanya; timestamp ada di dalam pesan yang ditandatangani justru agar rekaman lama bisa ditolak.
- **Beberapa tanda tangan dalam satu header** diterima, karena svix mengirim tanda tangan lama dan baru berdampingan sekitar sehari setelah rotasi secret.

Adapter menolak `createPayout` dan `getStatus` dengan `SumopodNotSupportedError`, bukan mengembalikan nilai yang tampak masuk akal. Payout tiruan terbaca seperti payout yang benar-benar terjadi.

Catatan tentang peringatan di `PaymentProvider.parseWebhook`: celah Midtrans tidak berlaku di sini. Midtrans hanya menandatangani `order_id + status_code + gross_amount`, sehingga `transaction_status` di luar pesan yang ditandatangani dan payload bisa diputar ulang dengan status diganti. Skema svix menandatangani seluruh badan mentah, jadi jenis event, nominal, dan fee semuanya tercakup. Karena itu adapter ini boleh mengembalikan `paid` atas dasar notifikasi saja, dan tidak membutuhkan status API yang memang tidak ada.

**Variabel lingkungan:** `SUMOPOD_API_KEY`, `SUMOPOD_WEBHOOK_SECRET`, `SUMOPOD_BASE_URL`, dan `PAYMENT_PROVIDER`. Ketiganya boleh kosong pada deployment yang belum memakai Sumopod: adapter menolak dibangun tanpa mereka, sehingga rute menjawab 503, bukan menerima event yang tidak terverifikasi.

**Jalur donasi sudah tersambung.** Rute donasi menerima metode `qris`, bertanya lebih dulu apakah penyedia aktif bisa melayani metode yang dipilih donatur, lalu membuat Donation, memanggil penyedia di luar transaksi basis data, dan menulis Payment dengan nama penyedia yang benar-benar menerbitkan tagihan. Halaman donasi menawarkan QRIS saja dan mengalihkan donatur ke `payment_link_url`.

Tiga perbaikan ikut masuk karena tersembunyi di balik gerbang 503:

- Halaman mengirim `id` metode, misalnya `bca`, padahal API memvalidasi `type`. Setiap pengiriman akan ditolak 400.
- Panggilan ke penyedia berada di dalam transaksi basis data. Aman selama penyedianya tiruan tanpa I/O; dengan HTTP nyata, satu respons lambat menahan koneksi dan penguncian baris sampai kolam koneksi habis.
- Halaman menampilkan "Donasi Berhasil" begitu Donation dibuat, padahal donatur belum membayar apa pun. Sekarang donatur dialihkan ke halaman pembayaran, dan layar itu berbunyi "Donasi Dibuat".

Biaya admin kosmetik per metode, Rp2.500 dan seterusnya, dihapus. Angka itu ditampilkan ke donatur dan ditambahkan ke total di layar, sedangkan API dikirimi nominal saja dan menagih persis itu.

## Bendera dan pengaman

Gerbang donasi bukan lagi konstanta yang dipaku, karena pengembangan perlu menjalankan seluruh alur terhadap sandbox sementara produksi tetap tertutup. Satu konstanta tidak bisa menjadi keduanya.

`NEXT_PUBLIC_DONATIONS_ENABLED` adalah sakelarnya, mati kecuali diisi persis string `true`. Nilai seperti `1`, `yes`, atau `TRUE` dihitung mati, karena menebak ke arah permisif mengubah salah ketik menjadi penghimpunan uang sungguhan. Awalan `NEXT_PUBLIC_` dipakai karena halaman donasi ikut membacanya untuk menampilkan pesan nonaktif sebelum donatur mengisi nominal; konsekuensinya nilai itu dipanggang ke bundel klien saat build, sehingga deployment Docker mengubahnya dengan build ulang, bukan restart.

Di belakang sakelar ada pengaman yang menolak lingkungan yang salah, apa pun isi sakelarnya:

| Kondisi di produksi | Akibat |
| --- | --- |
| `PAYMENT_PROVIDER` masih adapter tiruan | Setiap donasi ditolak 503 |
| `SUMOPOD_BASE_URL` mengandung `sandbox` | Setiap donasi ditolak 503 |
| `SUMOPOD_BASE_URL` tidak diisi | Setiap donasi ditolak 503 |

Di luar produksi ketiganya diizinkan, sehingga pengembangan memakai sandbox seperti biasa.

Pengaman ini ada karena kasusnya tidak bisa dipulihkan. Kredensial sandbox yang tertinggal di produksi menerima rupiah sungguhan ke akun yang tidak pernah settle: donatur membayar, webhook tidak pernah datang, buku besar tidak bergerak, dan uangnya hilang sejauh yang bisa dilihat platform. Tidak ada daftar periksa rilis yang selamat dari rilis terburu-buru, jadi penolakannya ditaruh di kode.

**Rencana yang disepakati.** Pengembangan sebelum launching memakai sandbox Sumopod dengan sakelar menyala. URL base produksi diberikan tepat sebelum launching; saat itu `SUMOPOD_BASE_URL` diganti dan sakelar dinyalakan di produksi, sebagai commit tersendiri agar mundurnya cukup satu revert.

Adapter tiruan sebaiknya dicabut begitu Sumopod jalan, supaya tidak ada dua jalur yang bisa menerima webhook.
