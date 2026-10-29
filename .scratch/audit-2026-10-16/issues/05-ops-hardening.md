# 05 Penguatan ops: OPS-2, OPS-4, OPS-5, OPS-6

**Status:** done
**Blocked by:** none

Sumber: audit 2026-10-16, bagian OPS-2, OPS-4, OPS-5, OPS-6 (OPS-3 dan OPS-7 bukan bagian tiket ini).

## Yang diubah di repo

- **OPS-2.** `POST /api/internal/jobs/run` menjawab 500 `{ok:false, failedPhases, result}` bila ada fase yang jatuh ke fallback, 200 hanya bila semua fase sukses (auth tidak berubah; detail galat tidak dikirim, hanya nama fase). `runScheduledJobsReport` di `src/lib/scheduled-jobs.ts` memberi daftar fase gagal. Heartbeat: `readJobsHeartbeat()` di `src/lib/jobs-heartbeat.ts` mengembalikan `{lastRunAt, lastRunOk, failedPhases, lastSuccessAt}`. Disimpan sebagai berkas JSON di temp container, bukan di `SiteSetting`: tabel itu butuh `updatedById` (FK ke User) dan kuncinya lima bagian laman publik; perubahan skema di luar lingkup. Akibatnya heartbeat kosong sesudah tiap deploy sampai run berikutnya (maksimal 15 menit) dan hanya berlaku untuk satu container. `/api/health` tidak disentuh; pemanggilnya perlu memanggil `readJobsHeartbeat()`.
- Fase "refund link expiry" tidak ada kodenya, jadi tidak bisa ditambahkan. `dormantBalanceReport` hanya daftar baca untuk halaman Admin tanpa notifikasi; menjalankannya tiap 15 menit tidak berguna, jadi sengaja tidak ditambahkan.
- **OPS-4.** `docker-compose.prod.yml`: healthcheck app (node fetch ke `/api/health`, tanpa curl), rotasi log json-file 10m x 5 di semua service, `mem_limit: 1g` dan `cpus: 1.0` untuk app dan db (titik awal konservatif, dikomentari). `postgres:16.15-alpine`; semua `FROM` di `Dockerfile` jadi `node:24.22.0-alpine`. Tidak ada perubahan di blok `environment`.
- **OPS-5.** `ci/local.sh` `run_test` mengekspor `TEST_DATABASE_URL="$DATABASE_URL"` (pilihan paling tidak mengganggu; komentar di tes sudah mengklaim ini). Guard di CI bahwa tes real-DB tidak di-skip belum ditambahkan.
- **OPS-6.** `ops/deploy.sh` memvalidasi dump pra-migrasi dengan `pg_restore --list` sebelum disimpan dan sebelum migrasi (bug sisi repo: dump terpotong lolos cek ukuran). Runbook baru `docs/runbooks/backup-dan-restore.md`.

## Yang harus dikerjakan owner di host

1. Pasang cron/timer pemanggil jobs bila belum, dan ubah agar gagal terlihat: `curl -fsS` sekarang gagal pada 500. Alarm pada exit non-nol atau log `jobs.log`.
2. Terapkan compose baru lewat deploy biasa. Healthcheck hanya menandai `unhealthy`; compose tidak restart otomatis, jadi pasang pemantau host (atau lihat `docker ps`). Setel `mem_limit`/`cpus` sesuai `docker stats`.
3. `postgres:16.15-alpine` menggantikan tag mengambang: image akan ditarik pada `up` berikutnya.
4. Pasang backup harian, salinan offsite, alarm umur backup, dan jadwalkan drill kuartal pertama (paling lambat awal Januari 2027) mengikuti runbook.

## Verifikasi

Tes terarah: scheduled-jobs, jobs-heartbeat, route jobs/run, docker-compose-prod, dockerfile, ops-deploy-script; `docker compose config` lolos; `tsc` tidak menambah galat. Full suite tidak dijalankan (diserahkan ke CI).
