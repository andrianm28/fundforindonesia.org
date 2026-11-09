# 05: Antrean notifikasi gagal, tandai-selesai webhook, email error ke Admin

**Blocked by:** 04 (slot skema)

**Status:** done

**What to build:** Pasal 8(2) meminta failed notification queue; saat ini kegagalan kirim email hanya `console.error` (src/lib/mail/index.ts). Simpan setiap kegagalan kirim ke tabel antrean (jenis, penerima di-hash/terenkripsi, payload minimal untuk kirim ulang, jumlah percobaan, galat terakhir). Job terjadwal yang sudah ada mencoba ulang dengan backoff sampai batas, lalu menandai gagal permanen. Layar Admin menampilkan antrean dengan tombol kirim ulang. Antrean tinjauan webhook di /admin/reconciliation mendapat tombol 'tandai selesai' dengan catatan (saat ini lewat SQL, docs/runbooks/payment-reconciliation.md:33). Kegagalan webhook dan antrean yang menumpuk mengirim email ringkas ke Admin (maksimal sekali per jam per jenis).

- [x] Test: kegagalan kirim masuk antrean; retry sukses mengosongkan; batas percobaan
- [x] Test: tandai selesai webhook tercatat dengan pelaku
- [x] Test throttle email error
- [ ] Review independen sonnet (keamanan dan konkurensi)

## Comments

- Skema + migrasi `20261110100000_failed_notification_queue`: enum `FailedNotificationStatus`, tabel `FailedNotification` dan `AdminAlertThrottle`, dan tiga kolom nullable di `WebhookEvent` (`resolvedAt`, `resolvedById`, `resolutionNote`). Hanya menambah; `prisma migrate diff` kosong setelah migrasi diputar ulang dari nol.
- Titik masuk tunggal: `sendReportingFailure` (src/lib/mail/index.ts) menulis baris ke antrean pada kegagalan (provider menolak atau Mailer tidak terkonfigurasi). Jalur yang memanggil `mailer.send` langsung (`campaign-transfers.ts` ke Donor Tamu) tidak lewat sini dan tetap hanya log; tidak diubah.
- Penerima tidak disimpan terbuka: seluruh `MailMessage` (alamat, subjek, isi) disegel dengan kunci `FIELD_*` (AAD `FailedNotification.payload`), penerima hanya `recipientHmac`. `context` hanya ID. Layar dan API tidak pernah mengembalikan payload. Tanpa kunci `FIELD_*` baris tidak bisa ditulis; kegagalan itu dicatat sebagai `mail_queue_write_failed` (tanpa isi) dan emailnya hanya ada di log.
- KEPUTUSAN TERBUKA: `password_reset` dan `email_verification` sengaja tidak diantrekan (tautan kredensial tidak boleh mengendap di database; pemilik bisa meminta ulang). Ubah `NOT_QUEUED_MAIL` bila owner mau lain.
- Retry: batas 5 kegagalan (yang pertama dihitung), jeda 5 menit, 15 menit, 1 jam, 4 jam. Klaim atomik `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING` dengan lease 10 menit di `claimedUntil`, jadi dua runner tidak memegang baris yang sama dan runner yang mati tidak mengunci baris selamanya (paling buruk satu email terkirim dua kali). Kirim ulang Admin memakai klaim yang sama (satu baris), jadi dua Admin sekaligus mengirim satu email.
- Job: fase baru `notificationQueue` di `runScheduledJobsReport`, terisolasi seperti fase lain.
- Email error ke Admin: dikirim dari fase job, bukan dari handler webhook, jadi jalur panas webhook tidak tersentuh; tertunda paling lama satu interval job (15 menit). Dua jenis, `notification_queue` (ada yang gagal permanen dalam 24 jam, atau 10+ baris menunggu) dan `webhook_review` (webhook atau charge tanpa Payment belum selesai yang masuk dalam 24 jam). Throttle satu `INSERT ... ON CONFLICT DO UPDATE ... WHERE lastSentAt <= now-1h RETURNING`, atomik; slot dikembalikan bila tidak ada email yang berhasil terkirim. Isi hanya hitungan dan tautan. Jendela 24 jam supaya item yang dibiarkan berminggu-minggu tidak mengirim email tiap jam.
- Tandai selesai: `resolveWebhookEvent` (src/lib/money/payment-reconciliation.ts), satu `UPDATE` bersyarat (outcome perlu tinjauan dan belum selesai), catatan wajib, pelaku dari sesi. `listReconciliationQueue` hanya menampilkan yang belum selesai. Charge tanpa Payment belum punya tombol (di luar tiket).
- Layar `/admin/notifikasi-gagal` dan API `POST /api/admin/failed-notifications/[id]/resend` dan `POST /api/admin/webhook-events/[id]/resolve`: 404 literal untuk non-Admin (layout dan `withHiddenAssignmentCheck`). Allowlist `roles-expand-guard` diperbarui dengan alasan.
- Tidak ada env baru, jadi docker-compose(.prod) dan tesnya tidak berubah.
- Runbook `insiden.md` (bagian Notifikasi gagal) dan `payment-reconciliation.md` (butir 6) diganti dengan prosedur baru.
