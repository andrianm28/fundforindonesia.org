# Staging: stg.fundforindonesia.org

Staging adalah salinan aplikasi untuk menguji `main` sebelum produksi: sama
image-nya, tetapi **database, `.env`, volume, port, dan kredensial Sumopod
terpisah total** dari produksi. Uang di staging selalu sandbox.

| | Produksi | Staging |
| --- | --- | --- |
| Domain | `fundforindonesia.org` | `stg.fundforindonesia.org` |
| Compose | `docker-compose.prod.yml` | `docker-compose.staging.yml` |
| Project compose | `fundforindonesia-prod` | `fundforindonesia-stg` |
| Port loopback app / db | 8093 / 18093 | 8094 / 18094 |
| Volume | `kibi-clone_*`, `ffi_private_documents` | `ffi_stg_postgres_data`, `ffi_stg_uploads`, `ffi_stg_private_documents` |
| Image app | `:<sha>` | `:<sha>-staging` (URL staging di-inline saat build) |
| Image migrate | `:<sha>-migrate` | sama, `:<sha>-migrate` |
| Deploy | `deploy.yml`, persetujuan owner | otomatis: timer menarik `:staging` tiap 5 menit |
| Sumopod | live | **sandbox saja** (`BETA_SANDBOX=true`) |
| Mesin pencari | diindeks | `noindex` (robots.txt, meta, header nginx) + basic auth |

## Cara kerja

1. Setiap commit hijau di `main`, `cd.yml` mendorong image app produksi,
   image migrate, **dan** image app staging `:<sha>-staging`, yang dibangun
   dengan `NEXT_PUBLIC_BASE_URL` dan `NEXTAUTH_URL` staging (Actions variables
   `STAGING_*`, bawaan `https://stg.fundforindonesia.org`). Tag `:staging`
   hanya pindah ke head `main`.
2. Di host, `ffi-staging-deploy.timer` menjalankan `ops/deploy-staging.sh`
   tiap 5 menit sebagai user `deploy`. Bila `:staging` tidak berubah dan app
   sehat, skrip langsung keluar tanpa menulis apa pun.
3. Bila berubah: tarik image migrate commit yang sama, dump DB staging
   (simpan 3), `prisma migrate deploy`, recreate app, cek `/api/health` 60
   detik. Gagal sehat: kembali ke rilis sebelumnya (exit 3).
4. Build yang alamatnya bukan domain kanonik otomatis `noindex`
   (`isCanonicalSite()` di `src/lib/public-url.ts`).

Produksi tidak tersentuh: skrip staging tidak mengenal compose, project,
port, atau volume produksi (dijaga `src/__tests__/ops-deploy-staging-script.test.ts`
dan `src/__tests__/docker-compose-staging.test.ts`).

## Pemasangan sekali di host (dijalankan agent server owner)

Detail host (IP, path persis, sandi) tidak ditulis di repo. Prompt langkah
demi langkah ada di folder proyek owner, bukan di sini.

1. **DNS**: record `A` (dan `AAAA` bila ada) `stg` ke IP host yang sama.
2. **Direktori deploy staging** terpisah dari produksi, misalnya
   `/home/deploy/fundforindonesia-stg`, berisi `docker-compose.staging.yml`,
   `ops/deploy-staging.sh` (owner `root:deploy`, mode 750, seperti
   `ops/deploy.sh`), dan `.env` staging (mode 640 `root:deploy`).
3. **Volume**: `docker volume create` untuk ketiga volume `ffi_stg_*`.
4. **`.env` staging**, semua nilai baru, tidak ada yang disalin dari produksi:
   - `DB_PASSWORD`, `NEXTAUTH_SECRET`, `JOBS_SECRET`, `RATE_LIMIT_SECRET`:
     acak baru (`openssl rand -base64 32`).
   - `NEXTAUTH_URL=https://stg.fundforindonesia.org`.
   - `FIELD_ENCRYPTION_KEY`/`_ID`, `FIELD_HMAC_KEY`/`_ID`: kunci baru dengan
     ID berbeda dari produksi (lihat `rotasi-kunci-field.md` untuk formatnya).
   - `BETA_SANDBOX=true`, `PAYMENT_PROVIDER=sumopod`,
     `SUMOPOD_BASE_URL=https://api-pay-sandbox.sumopod.com/api/v1`,
     `SUMOPOD_API_KEY` dan `SUMOPOD_WEBHOOK_SECRET` dari **project sandbox**
     Sumopod. Boot check menolak base url live selama `BETA_SANDBOX=true`.
   - `MAIL_PROVIDER` dikosongkan (email hanya dicatat, tidak terkirim) kecuali
     staging punya pengirim sendiri.
5. **Webhook Sumopod sandbox** diarahkan ke
   `https://stg.fundforindonesia.org/api/webhooks/sumopod`.
6. **nginx**: server block `stg.fundforindonesia.org` ke `127.0.0.1:8094`,
   sertifikat TLS (certbot), `add_header X-Robots-Tag "noindex, nofollow" always;`,
   dan basic auth untuk semua path **kecuali** `/api/webhooks/` (Sumopod harus
   bisa memanggilnya tanpa sandi).
7. **Systemd**: salin `ops/staging/ffi-staging-deploy.{service,timer}` ke
   `/etc/systemd/system/`, sesuaikan path, `systemctl enable --now
   ffi-staging-deploy.timer`.
8. **Deploy pertama**: `sudo -u deploy <dir>/ops/deploy-staging.sh`, lalu buka
   situsnya. Akun awal dibuat lewat registrasi biasa; penugasan Admin
   diberikan dengan cara yang sama seperti di produksi. Jangan jalankan demo
   seed (`prisma/seed.ts`) di staging bila staging dipakai untuk UAT dengan
   data mirip asli; boleh bila staging khusus demo.

## Operasi

- Log: `<dir>/logs/deploy-staging.log` (hanya mencatat saat deploy).
- Status timer: `systemctl list-timers ffi-staging-deploy.timer`,
  `journalctl -u ffi-staging-deploy.service`.
- Pin atau rollback ke commit tertentu di `main`:
  `sudo -u deploy <dir>/ops/deploy-staging.sh <sha-40-hex>` (timer akan
  memajukan lagi ke `:staging` pada putaran berikutnya bila `:staging` lebih
  baru; hentikan timer dulu bila ingin menahan versi).
- Paksa redeploy: `FORCE=1 sudo -E -u deploy <dir>/ops/deploy-staging.sh`.
- Hentikan staging seluruhnya: `systemctl disable --now ffi-staging-deploy.timer`
  lalu `docker compose -p fundforindonesia-stg down` (tanpa `-v`; volume
  eksternal tidak ikut terhapus).
- Reset data staging: hentikan stack, `docker volume rm ffi_stg_postgres_data`,
  buat ulang, deploy ulang. **Pastikan nama volume berawalan `ffi_stg_`.**

## Batas

- Staging berbagi CPU dengan produksi (host 4 vCPU). Batas sumber dayanya
  sengaja lebih kecil (app 768 MB / 0,5 CPU, db 512 MB / 0,5 CPU).
- Migrasi di staging berjalan lebih dulu daripada produksi, jadi staging
  adalah tempat pertama migrasi baru diuji pada data nyata-ish.
- Image staging tidak dipindai Trivy terpisah: isinya sama dengan image
  produksi yang sudah dipindai, hanya URL yang di-inline yang berbeda.
