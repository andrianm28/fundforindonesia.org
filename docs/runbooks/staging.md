# Runbook: lingkungan staging

Untuk gladi M1, M2, M3 end to end (donasi, Payout, Refund) dengan **Sumopod sandbox** sebelum uang nyata bergerak. Asal: `.scratch/go-live-ops/issues/02-staging-environment.md`. Dijalankan owner di host; agent tidak menyentuh host. Dokumen ini tanpa IP dan tanpa kredensial: nilainya ada di `.env.staging` di host, yang tidak pernah masuk repo.

## Apa yang terpisah dari produksi

| | Produksi | Staging |
| --- | --- | --- |
| Compose | `docker-compose.prod.yml` | `docker-compose.staging.yml` |
| Project | `fundforindonesia-prod` | `fundforindonesia-staging` |
| Database | `fund_indonesia`, user `fundindo` | `fund_indonesia_staging`, user `fundindo_staging` |
| Volume | `kibi-clone_*` (external) | `fundforindonesia-staging_postgres_data`, `..._uploads` (milik project, bukan external) |
| Port loopback | app 8093, db 18093 | app 8094, db 18094 |
| Image app | `<sha>` / `latest` | `<sha>-staging` (build arg staging) |
| Image migrate | `<sha>-migrate` | sama |
| Env file | `.env` | `.env.staging`, semua nama berawalan `STAGING_` |

Awalan `STAGING_` disengaja: `.env` produksi ada di host yang sama, dan nama yang sama akan membuat staging memakai kunci Sumopod, kunci enkripsi, dan password database produksi tanpa ada yang memilihnya. Selalu jalankan compose dengan `--env-file .env.staging`.

## Izin sandbox: hanya staging, tidak pernah default

Image staging adalah build produksi (`NODE_ENV=production`), jadi penjaga uang `sandboxInProductionReason` tetap berjalan di sana. Penanda eksplisit `DEPLOY_ENVIRONMENT=staging` (string persis; `Staging`, `true`, spasi ikut ditolak) membuat aturan Sumopod:

- menerima base URL sandbox;
- **menolak** base URL live (staging tidak boleh menerima uang nyata);
- tetap menolak base URL kosong, adapter mock, dan provider yang tidak dikenal.

Yang memasang penanda itu hanya `docker-compose.staging.yml`. `docker-compose.prod.yml` tidak boleh memasangnya, dan `src/__tests__/docker-compose-staging.test.ts` menjaganya. Tanpa penanda, produksi menolak sandbox seperti sebelumnya.

## Image staging

`cd.yml` membangun image app kedua dari Dockerfile yang sama dengan build arg staging (`NEXT_PUBLIC_*` terbaca saat build, jadi tidak bisa diubah saat run). Tag `<sha>-staging`, tidak pernah `latest`; digest-nya ada di ringkasan run CD sebagai baris "app (staging)" dan di output job `app-staging-digest`. Image produksi, tag, dan build arg-nya tidak berubah.

Variabel repo GitHub (publik; semua opsional karena ada default staging):

- `STAGING_NEXT_PUBLIC_BASE_URL` (default `https://staging.fundforindonesia.org`)
- `STAGING_NEXTAUTH_URL` (default sama)
- `STAGING_NEXT_PUBLIC_DONATIONS_ENABLED` (default `true`)
- `STAGING_NEXT_PUBLIC_VOLUNTEER_ENABLED` (default `true`)

Bila subdomain staging berbeda dari default, set dua variabel URL sebelum build pertama.

## Variabel `.env.staging`

Wajib: `STAGING_DB_PASSWORD`, `STAGING_NEXTAUTH_SECRET`, `STAGING_NEXTAUTH_URL`. Untuk gladi uang: `STAGING_SUMOPOD_API_KEY` dan `STAGING_SUMOPOD_WEBHOOK_SECRET` (kunci **sandbox**), plus `STAGING_FIELD_ENCRYPTION_KEY`, `STAGING_FIELD_ENCRYPTION_KEY_ID`, `STAGING_FIELD_HMAC_KEY`, `STAGING_FIELD_HMAC_KEY_ID`, `STAGING_JOBS_SECRET`, `STAGING_RATE_LIMIT_SECRET` (semuanya dibuat baru; jangan memakai nilai produksi). Opsional: `STAGING_SUMOPOD_BASE_URL` (default sandbox), `STAGING_PAYMENT_LINK_ALLOWED_HOSTS`, `STAGING_TRUSTED_PROXY_HOPS`, `STAGING_SHOW_DEMO_CAMPAIGNS`, `STAGING_GOOGLE_CLIENT_ID/SECRET`, `STAGING_PARTNERSHIP_TEAM_EMAIL`, dan blok surel `STAGING_MAIL_PROVIDER`, `STAGING_SMTP_*`, `STAGING_MAIL_FROM`.

Surel dibiarkan kosong (hanya dicatat di log) kecuali relay-nya mengarah ke kotak tangkap-semua: staging tidak boleh mengirim surel ke donor sungguhan.

## noindex dan basic auth: di nginx, bukan di aplikasi

Pilihan: nginx. Alasannya: (1) satu tempat untuk keduanya, tanpa build arg atau env baru dan tanpa image yang berbeda perilaku; (2) basic auth di depan aplikasi melindungi semua rute termasuk `/_next` dan API, sedangkan versi aplikasi harus menyentuh `src/proxy.ts` (gerbang next-auth) dan berisiko bentrok dengan pekerjaan lain; (3) `robots.txt` aplikasi sedang dikerjakan di tiket lain, dan header `X-Robots-Tag` tetap berlaku apa pun isinya.

Server block staging (hostname dan sertifikat diisi owner):

```nginx
server {
    server_name <subdomain staging>;
    # listen 443 ssl; sertifikat: isi sesuai host

    # noindex di semua respons, termasuk error.
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;

    auth_basic           "Staging";
    auth_basic_user_file /etc/nginx/staging.htpasswd;   # dibuat owner: htpasswd -c

    location / {
        proxy_pass http://127.0.0.1:8094;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Webhook Sumopod sandbox dan health check tidak bisa mengirim basic auth.
    # Webhook dilindungi tanda tangan whsec; health tidak membuka data.
    location = /api/webhooks/sumopod {
        auth_basic off;
        proxy_pass http://127.0.0.1:8094;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location = /api/health {
        auth_basic off;
        proxy_pass http://127.0.0.1:8094;
    }
}
```

Catatan: `add_header` di dalam `location` menimpa yang di `server`; bila nanti ada `add_header` lain di location, ulangi `X-Robots-Tag` di sana. `TRUSTED_PROXY_HOPS` tetap 1 selama nginx satu-satunya proxy. Basic auth memakai header `Authorization`, jadi login next-auth aplikasi tidak terganggu (cookie, bukan header itu).

## Bring-up pertama

1. Owner: DNS dan TLS untuk subdomain staging; `htpasswd` (kata sandi dibagikan di luar repo); server block di atas; `.env.staging` di host (izin `600`).
2. Ambil digest `app (staging)` dan `migrate` dari ringkasan run CD commit `main` yang hijau.
3. Dari direktori compose di host:
   ```bash
   export APP_DIGEST=sha256:...   # app (staging)
   export MIGRATE_DIGEST=sha256:...
   docker compose --env-file .env.staging -f docker-compose.staging.yml up -d db
   docker compose --env-file .env.staging -f docker-compose.staging.yml --profile migrate run --rm migrate
   docker compose --env-file .env.staging -f docker-compose.staging.yml up -d app
   ```
4. Pastikan `/api/health` menjawab 200 dan halaman meminta basic auth. Periksa respons membawa `X-Robots-Tag: noindex`.
5. Daftarkan URL webhook sandbox `https://<subdomain staging>/api/webhooks/sumopod` di dashboard Sumopod sandbox dan isi `whsec` ke `.env.staging`.

Pembaruan berikutnya: ganti `APP_DIGEST`/`MIGRATE_DIGEST`, jalankan migrate, lalu `up -d app`. Jangan menjalankan perintah ini di project produksi dan jangan memakai `.env` produksi.

## Seed: hanya staging

`prisma/seed.ts` membuat akun dengan **password publik** (`password123`) dan data contoh. Maka:

- Hanya untuk mesin developer dan staging. Seed menolak berjalan bila `NODE_ENV=production` kecuali `DEPLOY_ENVIRONMENT=staging` (`seedRefusal` di `src/lib/deploy-environment.ts`). Seed juga menolak database yang sudah berisi Campaign atau Donation.
- Seed **tidak** membaca atau menyalin data produksi, dan data produksi tidak pernah dimasukkan ke staging (tidak ada dump/restore dari produksi).
- Image app tidak membawa seed dan `tsx`, jadi seed dijalankan dari checkout repo yang mengarah ke database staging lewat port loopback `18094` (mis. terowongan SSH), dengan `DATABASE_URL` milik staging dan `DEPLOY_ENVIRONMENT=staging`:
  ```bash
  DEPLOY_ENVIRONMENT=staging DATABASE_URL='postgresql://fundindo_staging:<password staging>@127.0.0.1:18094/fund_indonesia_staging?schema=public' npm run seed
  ```
  Tidak ada `DATABASE_URL` produksi di shell itu. Seed memakai kunci enkripsi bidang dari env: pakai nilai `STAGING_FIELD_*` yang sama dengan app staging, supaya data seed bisa dibaca app.
- Karena password akun seed publik, basic auth nginx adalah satu-satunya pagar akses staging. Jangan mencabutnya.

## Mengulang dari nol

`docker compose --env-file .env.staging -f docker-compose.staging.yml down -v` menghapus **hanya** project staging (volume miliknya sendiri, bukan external). Lalu migrate dan seed lagi.

## Batas

Staging membuktikan alur dengan sandbox; ia tidak membuktikan kredensial produksi, KYB, atau penyelesaian uang nyata. Itu tetap dibuktikan di M1 produksi.
