# Runbook: backup terjadwal, salinan offsite, dan latihan restore

Untuk owner. Dokumen ini melengkapi `docs/runbooks/restore.md` (cara memulihkan) dengan sisi sebelumnya: cara memastikan backup **ada, utuh, dan di luar host**. Asal: temuan audit OPS-6 (`.scratch/audit-2026-10-16/issues/05-ops-hardening.md`).

Repo ini publik. Lokasi, nama bucket, alat enkripsi, kunci, dan kredensial hanya ada pada owner dan tidak ditulis di sini. Semua langkah di bawah adalah **langkah owner** di host produksi; agent tidak menyentuh host.

## Gambaran

| Lapisan | Apa | Di mana | Fungsi |
| --- | --- | --- | --- |
| Dump pra-migrasi | `ops/deploy.sh` membuat `pg_dump` format custom ke `$DEPLOY_DIR/backups`, menyimpan 7 terakhir (`KEEP_BACKUPS=7`) | Disk host yang sama | Alat rollback saat deploy. **Bukan backup**: hanya terbit saat ada deploy dan satu disk dengan data. |
| Dump terjadwal | cron atau systemd timer harian | Disk host, direktori terpisah | Backup harian dengan retensi |
| Salinan offsite | dump terenkripsi disalin ke luar host | Penyimpanan eksternal pilihan owner | Selamat dari kehilangan host/disk |
| Latihan restore | per kuartal, ke database sementara | Mesin atau container sementara | Bukti bahwa backup benar-benar bisa dipulihkan |

Sejak perbaikan OPS-6, `ops/deploy.sh` memvalidasi dump pra-migrasi dengan `pg_restore --list` sebelum menyimpannya dan sebelum migrasi; dump yang terpotong menghentikan deploy.

## 1. Dump harian terjadwal dengan retensi

Buat skrip di host (di luar repo, atau salin dari catatan ini). Isinya adalah dump, validasi, dan pembersihan. Sesuaikan `DEPLOY_DIR` dan nama berkas compose dengan host.

```bash
#!/usr/bin/env bash
# /usr/local/sbin/ffi-backup-db  (jalankan sebagai pengguna yang boleh memakai docker)
set -euo pipefail
DEPLOY_DIR="${DEPLOY_DIR:?isi path direktori deploy}"
OUT="${BACKUP_OUT:-$DEPLOY_DIR/backups-daily}"
KEEP_DAYS="${KEEP_DAYS:-14}"
umask 077
mkdir -p "$OUT"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$OUT/$ts-daily.dump"

compose() { docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/docker-compose.prod.yml" --env-file "$DEPLOY_DIR/.env" "$@"; }

# APP_DIGEST/MIGRATE_DIGEST wajib untuk membaca berkas compose; nilai apa pun
# yang valid cukup karena hanya service db yang disentuh.
export APP_DIGEST="${APP_DIGEST:-sha256:$(printf '0%.0s' {1..64})}" MIGRATE_DIGEST="${MIGRATE_DIGEST:-$APP_DIGEST}"

compose exec -T db pg_dump -U fundindo -d fund_indonesia --format=custom > "$dump.partial"
[ -s "$dump.partial" ]
# Dump terpotong tetap berisi byte: periksa daftar isinya.
compose exec -T db pg_restore --list < "$dump.partial" > /dev/null
mv "$dump.partial" "$dump"
sha256sum "$dump" > "$dump.sha256"

# Retensi: hapus dump harian yang lebih tua dari KEEP_DAYS hari.
find "$OUT" -maxdepth 1 -name '*-daily.dump*' -mtime +"$KEEP_DAYS" -delete
echo "ok $dump"
```

Jadwalkan, misalnya cron pukul 02:30 (di luar jam ramai) dengan log:

```cron
30 2 * * * /usr/local/sbin/ffi-backup-db >> "$DEPLOY_DIR/logs/backup.log" 2>&1
```

Atau systemd timer: `ffi-backup-db.service` (`Type=oneshot`, `ExecStart=` skrip di atas) dan `ffi-backup-db.timer` (`OnCalendar=*-*-* 02:30:00`, `Persistent=true`). `Persistent=true` menjalankan backup yang terlewat saat host mati.

Retensi yang disarankan: 14 hari harian di host, lebih lama (misalnya 30 hari harian dan 12 bulanan) di offsite. Sesuaikan dengan ruang disk; disk host pernah penuh, jadi periksa `df -h` dan ukuran direktori backup setelah minggu pertama.

Backup umur: pasang pemeriksaan sederhana yang membunyikan alarm bila dump terbaru lebih tua dari 26 jam, misalnya di monitoring host: `find "$OUT" -name '*-daily.dump' -mmin -1560 | grep -q .`. Tanpa ini, backup yang berhenti diam-diam baru ketahuan saat dibutuhkan.

## 2. Salinan offsite

Tujuan: satu salinan di luar host dan di luar akun/disk yang sama. Alat dan tujuan dipilih owner (penyimpanan objek, server lain lewat `rsync`/`scp`, dan sebagainya).

1. Enkripsi dump **sebelum** keluar dari host, dengan alat dan kunci milik owner (misalnya `age` atau `gpg`). Dump berisi data pribadi, termasuk kolom terenkripsi aplikasi. Kunci enkripsi backup disimpan **terpisah** dari backup dan dari host.
2. Salin berkas terenkripsi beserta `.sha256`-nya ke tujuan offsite dengan kredensial yang hanya punya hak tulis/tambah (bukan hak hapus) bila penyedianya mendukung.
3. Retensi di sisi offsite diatur oleh kebijakan penyimpanan di sana (lifecycle), bukan oleh skrip di host, agar host yang terkompromi tidak bisa menghapus semuanya.
4. Salin juga volume **uploads** (berkas unggahan tidak ada dalam dump database): arsipkan isi volume `uploads` (di compose: `/app/public/uploads`) dengan `tar` lewat container sementara yang memasang volume itu read-only, lalu enkripsi dan salin dengan cara yang sama. Contoh: `docker run --rm -v <nama-volume-uploads>:/data:ro -v "$OUT":/out alpine tar czf /out/$(date -u +%Y%m%d)-uploads.tgz -C /data .`
5. Simpan **key `FIELD_*`** (lihat `restore.md`) di tempat aman yang terpisah. Dump tanpa key itu terpulihkan tetapi kolom terenkripsi tidak terbaca.

Tambahkan langkah salin offsite ke akhir skrip (atau unit systemd terpisah) supaya satu kegagalan terlihat di `backup.log`.

## 3. Memeriksa setiap dump

Sudah otomatis di skrip di atas dan di `ops/deploy.sh`, tetapi bisa dijalankan manual pada berkas mana pun:

```bash
pg_restore --list /path/ke/berkas.dump > /dev/null && echo "daftar isi terbaca"
sha256sum -c /path/ke/berkas.dump.sha256
```

`pg_restore --list` hanya membuktikan struktur arsip terbaca, bukan bahwa seluruh data utuh; pembuktian penuh adalah latihan restore di bawah. Setelah menyalin offsite, hitung ulang checksum di sisi tujuan dan bandingkan.

## 4. Latihan restore per kuartal

Jadwalkan di kalender owner: **tiap kuartal** (Januari, April, Juli, Oktober). Drill terakhir yang tercatat: 2026-10-04 (lihat `restore.md`); berikutnya paling lambat awal Januari 2027. Catat tanggal drill berikutnya di tiket atau catatan owner setiap selesai.

Gunakan dump **offsite** terbaru (bukan salinan di host), karena itulah yang akan dipakai saat bencana: ambil, dekripsi, verifikasi checksum.

Restore ke database sementara, **bukan produksi**. Postgres sementara dengan versi mayor yang sama (16), contoh:

```bash
docker run -d --name ffi-drill -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" \
  -p 127.0.0.1:55432:5432 postgres:16.15-alpine
# tunggu sampai siap, lalu buat database kosong
docker exec ffi-drill createdb -U postgres drill
pg_restore --no-owner --no-privileges --exit-on-error \
  --dbname "postgresql://postgres:<password>@127.0.0.1:55432/drill" /path/ke/berkas.dump
```

Pemeriksaan yang diharapkan (rinci di `restore.md`, langkah 4 sampai 6):

1. **Restore selesai tanpa kesalahan** (`--exit-on-error`). Catat durasinya; bandingkan dengan drill sebelumnya (4 detik pada 2026-10-04) untuk melihat pertumbuhan.
2. **Jumlah baris** tabel utama sama dengan produksi pada saat dump dibuat:

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

3. **Buku besar seimbang**: debit sama dengan kredit.

   ```sql
   SELECT
     coalesce(sum(amount) FILTER (WHERE direction = 'DEBIT'), 0)  AS debit,
     coalesce(sum(amount) FILTER (WHERE direction = 'CREDIT'), 0) AS kredit
   FROM "LedgerEntry";
   ```

   Keduanya harus sama persis. Selisih berapa pun adalah temuan serius: hentikan, jangan menandai drill lulus, dan telusuri dengan `docs/runbooks/payment-reconciliation.md`.
4. **Migrasi lengkap**: `SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL;` harus 0, dan jumlah barisnya sama dengan jumlah folder di `prisma/migrations` pada commit yang berjalan.
5. **Uploads**: pulihkan arsip uploads ke volume sementara dan cocokkan jumlah berkas dengan produksi (`find . -type f | wc -l` di kedua sisi).
6. **Kunci**: bila aplikasi dijalankan terhadap hasil restore, uji dekripsi satu baris dengan key `FIELD_*` (lihat `restore.md`, langkah 7).

Bersihkan: `docker rm -f ffi-drill`, hapus dump dan salinan dekripsinya dari mesin kerja. Catat hasil (tanggal, umur dump, durasi, hasil tiap pemeriksaan, pelaksana) tanpa data pribadi dan tanpa nilai rahasia.

## Yang tidak boleh

- Jangan menaruh dump, kunci backup, key `FIELD_*`, hostname, IP, atau kredensial di repo, tiket, atau log CI.
- Jangan menjalankan drill terhadap database produksi yang sedang melayani lalu lintas.
- Jangan menganggap dump pra-migrasi `ops/deploy.sh` sebagai backup.
