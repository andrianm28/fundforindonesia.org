# Runbook: insiden (saklar, webhook, notifikasi, restore, eskalasi)

Bagian pertama (saklar donasi dan mode pemeliharaan) dan terakhir (eskalasi) dipakai Admin; bagian webhook, notifikasi, dan restore menunjuk ke runbook yang lebih rinci. Dipakai Admin saat ada kejadian yang menuntut uang berhenti masuk atau situs berhenti menerima tulisan: provider bermasalah, ledger tidak cocok, kebocoran kredensial, atau pemeliharaan terencana. Layarnya **Admin Panel > Operasional** (`/admin/operasional`). Perubahan berlaku saat itu juga, tanpa build ulang. Asal: `.scratch/pks-pemenuhan/issues/01-saklar-donasi-dan-mode-pemeliharaan.md`.

## Dua pengaman, dan hubungannya

| Pengaman | Diubah lewat | Sifat |
| --- | --- | --- |
| `NEXT_PUBLIC_DONATIONS_ENABLED` | variabel lingkungan, butuh build ulang | Gerbang keras. Selain `true` persis, donasi tertutup. |
| Saklar donasi | panel Operasional | Kunci kedua. Hanya bisa **menutup**. |

Donasi berjalan hanya bila env `true` **dan** saklar hidup. Panel tidak bisa membuka donasi yang ditutup env; bila env bukan `true`, halaman Operasional menulis peringatannya.

Mengosongkan `PAYMENT_PROVIDER` **bukan** kill switch: pilihan provider Admin di panel Payment Provider mengalahkannya.

## Menutup donasi (uang berhenti masuk)

1. Buka **Operasional**, matikan **Terima donasi**, klik **Simpan**.
2. Yang berhenti dengan jawaban 503 dan pesan "Donasi sedang tidak tersedia ...": `POST /api/donations`, `POST /api/donations/[id]/retry`, dan pendaftaran Volunteer Trip berbayar. Halaman donasi langsung menampilkan pesan donasi ditutup.
3. Yang **tetap jalan**: webhook provider. Pembayaran yang sudah berjalan harus tetap tercatat; mematikannya membuat uang ada di provider tanpa catatan.
4. Setelah masalah selesai, jalankan `GET /api/admin/reconcile` (atau halaman **Rekonsiliasi**) dan pastikan seimbang sebelum menyalakan lagi.

## Mode pemeliharaan (situs berhenti menerima tulisan)

1. Buka **Operasional**, nyalakan **Mode pemeliharaan**, isi pesan bila perlu (maks. 500 karakter; kosong memakai pesan bawaan), klik **Simpan**.
2. Efeknya:
   - Semua halaman publik menampilkan banner dengan pesan itu.
   - Semua `POST`, `PUT`, `PATCH`, dan `DELETE` ke `/api/*` dari selain Admin dijawab 503 dengan pesan itu dan header `Retry-After`. Membaca (`GET`) tidak ditolak.
3. Yang **tetap jalan**: `/admin` dan `/api/admin` (jalan untuk mematikan mode ini), webhook, `/api/health` (dipoll skrip deploy), login/logout, pekerjaan terjadwal (`/api/internal`), dan laporan error browser. Admin yang sedang masuk tetap bisa menulis.
4. Bila pembacaan setelan gagal (database tak terjangkau), mode ini tidak menolak apa pun: gagal terbuka, supaya setelan yang tak terbaca tidak mematikan API. Saklar donasi sebaliknya gagal **tertutup**. Kegagalan ini tidak diam: proxy menulis satu baris JSON ke log, `{"event":"maintenance_lookup_failed","reason":"error"|"timeout","policy":"open"}`. Bila Admin menyalakan mode ini tetapi tulisan masih masuk, cari event itu di log aplikasi. Batas waktu pembacaan 1 detik.
5. **`/api/auth` tetap terbuka** selama pemeliharaan, termasuk pendaftaran (`/api/auth/register`) dan reset kata sandi, karena seluruh awalan itu dikecualikan (perlu supaya login dan logout jalan). Akibatnya akun baru masih bisa dibuat saat situs "berhenti menerima tulisan". Ini disengaja dan dijaga tes `src/proxy.maintenance.test.ts`; bila owner ingin menutupnya, pengecualiannya harus dipersempit di `MAINTENANCE_EXEMPT` (`src/proxy.ts`).

## Jejak perubahan

Setiap perubahan (siapa, kapan, nilai lama dan baru) tercatat dan tampil di **Riwayat perubahan** pada halaman yang sama; 50 terakhir disimpan. Datanya satu baris `SiteSetting` berkunci `operations`, terpisah dari Pengaturan Laman Publik.

## Bila panel tidak terjangkau

Admin tidak bisa masuk panel (mis. login rusak): owner menutup donasi dengan mengubah `NEXT_PUBLIC_DONATIONS_ENABLED` dan membangun ulang image, di host produksi, mengikuti alur deploy biasa.

## Webhook penyedia gagal atau tidak cocok

Gejala: pembayaran sudah terjadi di dashboard penyedia tetapi Donation tidak berstatus lunas, atau muncul baris di **Rekonsiliasi > Antrean webhook yang perlu ditinjau** atau **Charge tanpa Payment**.

1. Jangan matikan webhook (lihat bagian "Menutup donasi": webhook sengaja tetap jalan). Bila uang masih bisa masuk dan sumbernya diduga bermasalah, tutup donasi dulu.
2. Buka **Rekonsiliasi** (`/admin/reconciliation`) dan kerjakan per jenis outcome sesuai [payment-reconciliation.md](payment-reconciliation.md): `UNKNOWN_PAYMENT`, `SIBLING_ALREADY_PAID`, `AMOUNT_MISMATCH`, `LATE_SETTLEMENT_REFUND_FAILED`.
3. Webhook yang dijawab 503 umumnya berarti kunci verifikasi tanda tangan (`SUMOPOD_WEBHOOK_SECRET`) kosong di lingkungan produksi (tanda tangan tidak bisa diperiksa). Itu perbaikan konfigurasi oleh owner ([konfigurasi-penyedia.md](../konfigurasi-penyedia.md)); setelah itu, minta penyedia mengirim ulang event dari dashboard-nya, lalu jalankan Rekonsiliasi.
4. Tutup dengan memastikan Ringkasan Rekonsiliasi menulis "Tidak ada temuan" sebelum donasi dibuka kembali.

## Notifikasi gagal

Keadaan sekarang (sebelum tiket 05, `.scratch/pks-pemenuhan/issues/05-antrean-notifikasi-gagal.md`, selesai): **kegagalan email hanya dicatat di log server**, belum ada antrean, layar, atau percobaan ulang. Keputusan bisnisnya tetap jalan: Verifier tetap memutuskan, status Payout dan Refund tetap berubah, notifikasi dalam aplikasi tetap dibuat; hanya emailnya yang hilang.

Yang bisa dilakukan sekarang:

1. Minta developer mencari di log aplikasi (dan GlitchTip bila `SENTRY_DSN` diisi) event `mail_send_failed`, `mail_not_configured`, `mail_compose_failed`, atau `mail_skipped`. Setiap event memuat id rekaman yang bersangkutan.
2. `mail_not_configured` berarti `MAIL_PROVIDER` atau `SMTP_*` / `MAIL_FROM` belum lengkap di produksi: perbaikan konfigurasi oleh owner ([konfigurasi-penyedia.md](../konfigurasi-penyedia.md)).
3. Untuk penerima yang pentingnya mendesak (mis. Payout selesai, Suspension), hubungi lewat kontak lain di luar platform. Email tidak dikirim ulang otomatis.
4. Setelah tiket 05 selesai, bagian ini diganti dengan prosedur antrean notifikasi gagal.

## Restore (data hilang atau rusak)

Putusan memulihkan database produksi adalah keputusan owner dan dikerjakan owner; Admin tidak menjalankan restore. Peran Admin: menutup donasi dan menyalakan mode pemeliharaan (bagian atas) supaya tidak ada tulisan baru, mencatat kapan kejadian mulai, lalu mengeskalasi sebagai **Kritis**.

- Cara memulihkan dan latihan restore: [restore.md](restore.md).
- Backup terjadwal, salinan offsite, dan retensi: [backup-dan-restore.md](backup-dan-restore.md).
- Kunci `FIELD_*` yang sama harus tersedia, kalau tidak kolom terenkripsi tidak terbaca ([rotasi-kunci-field.md](rotasi-kunci-field.md)).
- Setelah restore: jalankan **Rekonsiliasi** karena pembayaran yang terjadi sesudah titik backup ada di penyedia tetapi tidak di database; baru buka kembali donasi.

## Eskalasi

Eskalasi menurut **peran**, bukan nama atau nomor (kontak pribadi disimpan owner di luar repo, repo ini publik). Tingkat keparahan mengikuti target dukungan: hari kerja Senin sampai Jumat, pukul 09.00 sampai 17.00 WIB.

| Tingkat | Contoh | Target respons |
| --- | --- | --- |
| **Kritis** | Donasi tidak bisa dihentikan padahal harus, ledger tidak seimbang, dugaan kebocoran kredensial atau data, situs mati, restore diperlukan | 2 jam |
| **Tinggi** | Webhook gagal berulang, Payout atau Refund macet, email penting tidak terkirim massal, fitur utama rusak tetapi uang aman | 4 jam |
| **Normal** | Pertanyaan penggunaan, galat tampilan, perubahan konfigurasi, email tunggal gagal | 1 hari kerja |

Target dihitung dalam jam kerja di atas; laporan di luar jam itu dihitung masuk pada pukul 09.00 WIB hari kerja berikutnya. Untuk **Kritis**, tindakan penahan (tutup donasi, mode pemeliharaan) boleh dan harus dilakukan Admin kapan pun tanpa menunggu respons.

Urutan:

1. **Admin YIEM** yang menemukan: nilai keparahan, ambil tindakan penahan yang ada di panel (saklar donasi, mode pemeliharaan), catat gejala, waktu mulai (WIB), dan id yang terkait (Campaign, Payment, Payout) tanpa data pribadi donatur.
2. **Kontak insiden** (peran di sisi Platform Operator yang ditunjuk owner): menerima laporan dari Admin, memutuskan keparahan akhir, dan meneruskan ke developer. Untuk Kritis, owner ikut diberi tahu.
3. **Developer**: diagnosis dan perbaikan (log, GlitchTip, rekonsiliasi), deploy perbaikan lewat alur deploy owner, lalu melapor balik ke kontak insiden. Pemulihan database dan perubahan lingkungan produksi tetap dikerjakan owner.
4. Setelah selesai: Admin menjalankan Rekonsiliasi, membuka kembali saklar, dan kontak insiden mencatat ringkasan kejadian dan penyebabnya.

Bila panel tidak terjangkau, lihat bagian "Bila panel tidak terjangkau" di atas.
