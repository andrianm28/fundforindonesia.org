# Runbook: restore database dari backup terenkripsi

Dipakai untuk dua hal: **restore drill** berkala (membuktikan backup benar-benar bisa dipulihkan) dan **pemulihan nyata** bila data produksi hilang atau rusak. Drill pertama lulus 2026-10-04: restore ke Postgres sementara selesai dalam 4 detik dan jumlah baris identik dengan produksi. Asal: `.scratch/percepatan-full-rilis/plan.md` (Track A1).

Dokumen ini sengaja generik. Lokasi backup, nama bucket, alat dan kunci enkripsi backup, serta kredensial hanya diketahui owner dan tidak ditulis di repo (repo ini publik). Langkah yang hanya bisa dikerjakan owner ditandai **langkah owner**.

## Yang harus ada sebelum mulai

- Berkas backup (dump `pg_dump` format custom, `.dump`), lokal atau salinan offsite. Backup offsite terenkripsi, jadi ia harus didekripsi lebih dulu (**langkah owner**: alat dan kunci backup ada pada owner).
- **Key `FIELD_*` yang sama dengan yang dipakai saat data ditulis**: `FIELD_ENCRYPTION_KEY`, `FIELD_ENCRYPTION_KEY_ID`, `FIELD_HMAC_KEY`, `FIELD_HMAC_KEY_ID` (lihat `.env.example`). Email, telepon, dan nomor rekening di dump tersimpan terenkripsi (ADR 0012). Restore database tanpa key itu tetap berhasil, tetapi semua kolom terenkripsi tidak bisa dibaca dan pencarian email Guest Donor tidak cocok. Simpan key itu terpisah dari backup dan jangan pernah menaruhnya di repo. Bila key sudah dirotasi, key id lama harus tetap tersedia.
- Postgres sementara dengan versi mayor yang sama dengan produksi, terpisah dari database produksi. Untuk drill, pakai container atau instance lokal yang dibuang setelahnya. **Jangan pernah memulihkan ke database produksi yang sedang berjalan untuk keperluan drill.**
- Alat `pg_restore` dan `psql` yang versinya tidak lebih lama dari dump.

## Langkah

1. **Siapkan berkas dump.** Ambil backup terbaru (untuk drill, pilih yang berumur kurang dari 24 jam) dan dekripsi (**langkah owner**). Hitung checksum berkasnya dan catat. Berkas ini berisi data pribadi: simpan dengan izin terbatas dan hapus salinan kerja setelah selesai.
2. **Buat Postgres sementara.** Mulai instance kosong dengan nama database dan pengguna baru, misalnya lewat Docker dengan password acak sekali pakai. Pastikan ia hanya mendengarkan di localhost.
3. **Restore.**

   ```bash
   pg_restore --no-owner --no-privileges --exit-on-error \
     --dbname "$RESTORE_DATABASE_URL" /path/to/backup.dump
   ```

   `RESTORE_DATABASE_URL` menunjuk ke Postgres sementara, bukan produksi. Catat durasinya. Kesalahan apa pun menghentikan restore (`--exit-on-error`); jangan lanjut ke verifikasi bila ada kesalahan.
4. **Verifikasi jumlah baris.** Jalankan hitungan yang sama di Postgres sementara dan di produksi (hitungan produksi dijalankan **owner**, read-only), lalu bandingkan satu per satu:

   ```sql
   SELECT 'User' AS tabel, count(*) FROM "User"
   UNION ALL SELECT 'Campaign', count(*) FROM "Campaign"
   UNION ALL SELECT 'Donation', count(*) FROM "Donation"
   UNION ALL SELECT 'Payment', count(*) FROM "Payment"
   UNION ALL SELECT 'LedgerEntry', count(*) FROM "LedgerEntry"
   UNION ALL SELECT 'Payout', count(*) FROM "Payout"
   UNION ALL SELECT 'Refund', count(*) FROM "Refund"
   UNION ALL SELECT 'Registration', count(*) FROM "Registration"
   ORDER BY tabel;
   ```

   Produksi terus menulis, jadi selisih kecil pada tabel yang aktif wajar bila dump lebih tua dari hitungan produksi. Untuk drill yang bersih, bandingkan dengan hitungan yang diambil sesaat setelah dump dibuat. Selisih pada tabel yang tidak aktif (misalnya `Campaign`) berarti ada masalah.
5. **Verifikasi buku besar seimbang.** Jumlah debit dan kredit seluruh `LedgerEntry` harus sama:

   ```sql
   SELECT
     sum(amount) FILTER (WHERE direction = 'DEBIT')  AS debit,
     sum(amount) FILTER (WHERE direction = 'CREDIT') AS kredit
   FROM "LedgerEntry";
   ```

6. **Verifikasi migrasi.** Tabel `_prisma_migrations` harus memuat migrasi yang sama dengan commit yang berjalan di produksi, semuanya `finished_at` terisi dan tidak ada yang gagal.
7. **Verifikasi key `FIELD_*` (hanya bila aplikasi akan dijalankan terhadap hasil restore).** Jalankan aplikasi di lingkungan terisolasi dengan `DATABASE_URL` ke Postgres sementara dan key yang sama, lalu jalankan tes dekripsi satu baris lewat modul `src/lib/field-encryption.ts` (misalnya satu email Donation) atau buka halaman yang mendekripsi data. Bila dekripsi gagal, key atau key id salah. Jangan menampilkan atau mencatat nilai pribadi hasil dekripsi di log atau laporan.
8. **Catat hasil drill** (di tiket atau catatan owner, tanpa data pribadi dan tanpa nilai rahasia): tanggal, umur dump, durasi restore, hasil perbandingan tiap tabel, hasil buku besar, dan siapa yang menjalankan.
9. **Bersihkan.** Hapus Postgres sementara beserta volumenya, dan hapus dump dan salinan dekripsinya dari mesin kerja.

## Bila ini pemulihan nyata, bukan drill

Langkah 1 sampai 6 sama, tetapi targetnya database produksi yang baru dan kosong, dan keputusannya milik owner:

- **Langkah owner:** menghentikan aplikasi (kill switch donasi: kosongkan `PAYMENT_PROVIDER` lalu restart) sebelum menyentuh data, memilih backup yang dipulihkan, dan menjalankan semua perintah di host produksi.
- Data yang ditulis setelah backup terakhir hilang. Donasi yang sudah dibayar di payment provider tetapi tidak ada di data hasil restore harus direkonsiliasi lewat dashboard provider dan `docs/runbooks/payment-reconciliation.md`.
- Jalankan migrasi (`prisma migrate deploy`) bila dump lebih tua dari rilis yang sedang berjalan.
- Pastikan volume uploads dipulihkan dari backup volume-nya sendiri; dump database tidak memuat berkas unggahan.
- Setelah aplikasi hidup kembali, jalankan `GET /api/admin/reconcile` dan pastikan seimbang sebelum membuka kembali donasi.

## Yang tidak boleh

- Jangan menaruh dump, key `FIELD_*`, atau kredensial di repo, tiket, komentar PR, atau log CI.
- Jangan memulihkan ke database produksi yang sedang melayani lalu lintas untuk keperluan drill.
- Jangan menjalankan restore dari sesi agent: agent tidak menyentuh host produksi.
