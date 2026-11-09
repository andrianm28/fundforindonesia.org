# Fund for Indonesia

Platform galang dana dan dampak sosial (donasi, wakaf, hibah, Volunteer Trip, kolaborasi CSR) milik dan dioperasikan **PT Jaya Korpora Prima** (identitas resmi: `src/lib/site-identity.ts`, [ADR 0009](docs/adr/0009-platform-operated-by-pt-jaya-korpora-prima.md)). Pembayaran lewat penyedia (Sumopod lebih dulu, antarmuka `PaymentProvider` netral, [ADR 0006](docs/adr/0006-provider-neutral-payments-sumopod-first.md)). Istilah domain ada di [CONTEXT.md](CONTEXT.md).

Repo ini publik. Tidak ada host, IP, kredensial, atau data pribadi di dalamnya; semua nilai rahasia hidup di `.env` host produksi milik owner.

## Stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, next-intl
- Prisma 7 dengan PostgreSQL (`@prisma/adapter-pg`); skema di `prisma/schema.prisma`
- next-auth 4 (kredensial, plus Google bila dikonfigurasi)
- Nodemailer untuk email (SMTP), Sentry-kompatibel (GlitchTip) untuk pemantauan galat
- Vitest (unit dan integrasi), Playwright (e2e)
- Docker dan Docker Compose; image dibangun di GitHub Actions dan disimpan di GHCR

## Peta repo

| Path | Isi |
| --- | --- |
| `src/app/` | Halaman dan route handler. `admin/` (panel Admin), `moderasi/` (panel Verifier), `akun/` (akun Fundraiser, organisasi, CSR), `api/` (REST internal, `api/webhooks/[provider]` untuk webhook penyedia, `api/internal/jobs/run` untuk pekerjaan terjadwal, `api/health`) |
| `src/lib/` | Logika domain. `money/` memegang buku besar, Escrow Hold, Payout, Refund, rekonsiliasi; `mail/` mailer; `site-identity.ts` identitas operator |
| `src/components/` | Komponen UI per area (`admin/`, `moderasi/`, `campaign/`, dst.) |
| `prisma/` | `schema.prisma`, `migrations/`, `seed.ts`, `backfill-contact-fields.ts` |
| `tests/e2e/` | Spesifikasi Playwright dan seed e2e |
| `ci/` | `local.sh`, `ratchet.mjs`, `baselines.json`, `deploy-gate.sh` |
| `ops/` | `deploy.sh` (skrip deploy di host produksi), `mcp-ops/` |
| `docs/` | `adr/` (keputusan arsitektur), `runbooks/`, `panduan-admin/`, `konfigurasi-penyedia.md`, `integrasi-sumopod.md`, `agents/` |
| `.scratch/` | Spec dan tiket kerja (markdown, dikomit) |
| `Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `deploy.sh` (root) | Container. `docker-compose.yml` dan `deploy.sh` di root untuk lokal dan bootstrap; produksi memakai `docker-compose.prod.yml` dan `ops/deploy.sh` |

## Setup lokal

Prasyarat: Node 24 (`engines`: `>=24 <25`), npm, PostgreSQL.

```bash
npm ci
cp .env.example .env          # lalu isi nilai lokal; lihat bagian Variabel lingkungan
# DATABASE_URL harus menunjuk ke Postgres lokal (dibaca prisma.config.ts)
npx prisma generate
npx prisma migrate deploy     # atau `npx prisma migrate dev` saat mengubah skema
npx prisma db seed            # data demo (prisma/seed.ts); hanya untuk database kosong
npm run dev                   # http://localhost:3000
```

Alternatif dengan Docker: `./deploy.sh` (build, database, migrasi, app; `SEED=1 ./deploy.sh` memuat seed demo ke database kosong). Hanya untuk lokal dan bootstrap.

Di lokal, `MAIL_PROVIDER` kosong berarti mailer mock (tidak mengirim apa pun), `PAYMENT_PROVIDER=mock`, dan donasi tertutup kecuali `NEXT_PUBLIC_DONATIONS_ENABLED=true`.

## Variabel lingkungan

Daftar lengkap, dengan komentar per variabel, ada di [`.env.example`](.env.example). Ringkasan per kelompok (hanya nama):

| Kelompok | Variabel |
| --- | --- |
| Database | `DB_PASSWORD`, `DATABASE_URL` |
| Auth | `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Alamat publik | `NEXT_PUBLIC_BASE_URL` (ditanam saat build) |
| Pembayaran | `PAYMENT_PROVIDER`, `SUMOPOD_API_KEY`, `SUMOPOD_WEBHOOK_SECRET`, `SUMOPOD_BASE_URL`, `PAYMENT_LINK_ALLOWED_HOSTS`, `MOCK_MIDTRANS_SERVER_KEY`, `ALLOW_MOCK_PAYMENT_PROVIDER` |
| Gerbang fitur | `NEXT_PUBLIC_DONATIONS_ENABLED`, `NEXT_PUBLIC_VOLUNTEER_ENABLED`, `WAKAF_HIBAH_OPEN`, `BETA_SANDBOX`, `SHOW_DEMO_CAMPAIGNS` |
| Email | `MAIL_PROVIDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `PARTNERSHIP_TEAM_EMAIL` |
| Enkripsi field | `FIELD_ENCRYPTION_KEY`, `FIELD_ENCRYPTION_KEY_ID`, `FIELD_HMAC_KEY`, `FIELD_HMAC_KEY_ID`, `FIELD_ENCRYPTION_PREVIOUS_KEYS`, `FIELD_HMAC_PREVIOUS_KEYS` |
| Pekerjaan terjadwal dan rate limit | `JOBS_SECRET`, `RATE_LIMIT_SECRET`, `TRUSTED_PROXY_HOPS` |
| Pemantauan | `SENTRY_DSN` |
| Refund oleh Donor | `DONOR_REFUND_WINDOW_HOURS`, `DONOR_REFUND_MAX_OPEN_PER_DONOR`, `DONOR_REFUND_MAX_AMOUNT_*` |

Variabel `NEXT_PUBLIC_*` ditanam ke bundel saat build: mengubahnya butuh build ulang image, bukan sekadar restart. Penjelasan per penyedia: [docs/konfigurasi-penyedia.md](docs/konfigurasi-penyedia.md). Jangan pernah menaruh nilai asli di repo.

## Pengujian

```bash
npx vitest run                 # seluruh suite (satu proses sekaligus; di mesin kecil jalankan berurutan)
npx vitest run path/ke/file.test.ts
npm run test:e2e               # Playwright; butuh build produksi dan database sementara
npm run ci:local               # tes, build, migrasi (Postgres lokal sementara), ratchet, urutan sama dengan CI
npm run ci:local -- test ratchet   # subset
```

`ci/baselines.json` adalah **ratchet**: jumlah galat `tsc` dan lint boleh turun, tidak boleh naik. `ci/ratchet.mjs` membandingkannya dengan basis PR dan dengan base branch, jadi menaikkan baseline harus terlihat jelas di diff. Job `e2e` hanya berjalan di GitHub Actions. Aturan verifikasi: [docs/agents/verification.md](docs/agents/verification.md).

## CI/CD

| Workflow | Pemicu | Fungsi |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push dan PR ke `main`, manual | `test-shard` (vitest 3 shard) lalu agregat `test`, `build`, `migrations` (migrasi pada database kosong), `ratchet`, `e2e` |
| `.github/workflows/cd.yml` | setelah CI hijau di `main`, PR, manual | Membangun image app dan migrate, mendorong ke GHCR (hanya di `main`), uji migrasi dan health check dari image, pindai kerentanan |
| `.github/workflows/deploy.yml` | **manual saja**, di `main` | Job `gate` memeriksa commit dan image, job `deploy` menunggu persetujuan environment `production` lalu menjalankan `ops/deploy.sh` di host |

`main` dilindungi branch protection (check wajib: `test`, `build`, `migrations`, `ratchet`, `e2e`). Merge hanya setelah semua check hijau.

## Prosedur deploy

Deploy ke produksi **bukan otomatis**.

1. Pastikan CI dan CD hijau di `main` untuk commit yang akan dirilis (image ada di GHCR).
2. Owner menjalankan **Actions > Deploy > Run workflow** di `main`, dengan SHA commit (kosong berarti kepala `main`). Agent cloud tidak pernah men-dispatch; agent di host produksi hanya dengan izin eksplisit owner per deploy.
3. Job `gate` (`ci/deploy-gate.sh`) memastikan commit ada di `main`, CI lulus, dan provenance image cocok. Digest diambil dari GHCR, bukan dari form.
4. Owner (satu-satunya reviewer environment `production`) menyetujui job `deploy`.
5. `ops/deploy.sh <sha> <app-digest> <migrate-digest>` di host: kunci anti-tumpang-tindih, tarik image, dump database ke `backups/` (7 terakhir), `prisma migrate deploy`, ganti app, poll `/api/health` sekitar 60 detik, catat rilis di `state/`. Kode keluar: 0 sukses, 1 gagal, 2 argumen salah, 3 app baru tidak sehat dan rilis sebelumnya dipulihkan, 4 tidak sehat dan tidak ada rilis sehat (perlu manusia).
6. Sebelum deploy yang memuat migrasi pengisian kolom (mis. `prisma/backfill-contact-fields.ts`), jalankan skripnya lebih dulu; lihat catatan di `ops/deploy.sh` dan `.env.example`.

**Rollback.** Bila health check gagal, `ops/deploy.sh` otomatis memulihkan rilis sebelumnya (kode keluar 3). Bila masalah baru terlihat belakangan: dispatch deploy lagi dengan SHA rilis sebelumnya (image-nya masih di GHCR dan CI-nya lulus). **Migrasi tidak dibalik** (hanya maju); bila skema atau data rusak, jalan mundurnya adalah dump pra-migrasi atau backup: [docs/runbooks/restore.md](docs/runbooks/restore.md). Untuk menutup uang masuk seketika tanpa deploy: saklar donasi di **Admin > Operasional** ([insiden.md](docs/runbooks/insiden.md)).

## Dokumentasi lain

- Runbook operasional: [docs/runbooks/](docs/runbooks/) ([insiden](docs/runbooks/insiden.md), [rekonsiliasi pembayaran](docs/runbooks/payment-reconciliation.md), [restore](docs/runbooks/restore.md), [backup](docs/runbooks/backup-dan-restore.md), [rotasi key field](docs/runbooks/rotasi-kunci-field.md), [beta ke live](docs/runbooks/beta-ke-live.md))
- Keputusan arsitektur: [docs/adr/](docs/adr/)
- Panduan Admin dan Verifier per modul panel: [docs/panduan-admin/](docs/panduan-admin/README.md)
- Konfigurasi penyedia eksternal: [docs/konfigurasi-penyedia.md](docs/konfigurasi-penyedia.md), [docs/integrasi-sumopod.md](docs/integrasi-sumopod.md)
- Kebutuhan produk: [docs/PRD-fund-for-indonesia.md](docs/PRD-fund-for-indonesia.md); istilah domain: [CONTEXT.md](CONTEXT.md)
