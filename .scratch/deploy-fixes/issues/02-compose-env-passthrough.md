# 02: Env jobs dan mail tidak diteruskan ke container app produksi

**Type:** bug (ditulis retroaktif)

**Status:** done (PR #185, 993fdbb)

**Blocked by:** none

## Konteks

Temuan checklist pra-deploy Rilis 1. `docker-compose.prod.yml` mendaftar env
service `app` secara eksplisit, dan `ops/deploy.sh` hanya memberikan `.env`
kepada compose untuk interpolasi, jadi beberapa env server tidak pernah sampai
ke container. Akibatnya endpoint cron jobs menjawab 503 dan email tidak
terkirim di produksi, walau `.env` sudah terisi.

## Cakupan

- Teruskan `JOBS_SECRET`, `MAIL_PROVIDER`, `SMTP_HOST`, `SMTP_PORT` (bawaan
  465), `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, dan
  `PARTNERSHIP_TEAM_EMAIL`. Semuanya opsional (`:-`) karena kode sudah
  fail-closed dan mencatat `mail_not_configured`.
- Tes `src/__tests__/docker-compose-prod.test.ts` memindai teks kode `src/`
  untuk nama env yang tertulis literal (`process.env.X`, `process.env["X"]`,
  `process.env['X']`, `requireEnv('X')`, konstanta `*_ENV = 'X'`) dan gagal
  bila ada yang tidak diteruskan. Akses dinamis (`process.env[key]`,
  `process.env` utuh) tidak terlihat oleh pemindai; berkas pelakunya didaftar
  tangan di `DYNAMIC_READERS` beserta nama yang dibaca, dan tes gagal bila
  muncul berkas dinamis baru yang belum terdaftar. Batasnya: isi daftar itu
  dijaga manusia. Allowlist `NOT_PASSED`: `NODE_ENV` dan dua
  `*TEST_DATABASE_URL`; `NEXT_PUBLIC_*` dilewati.
- Di luar cakupan: env milik PR #161 dan #179; tes ini akan menangkapnya bila
  PR itu merge lebih dulu.

## Kriteria penerimaan

- [x] Kesembilan env diteruskan ke service `app` dengan nama yang sama dengan yang dibaca kode.
- [x] Tidak ada nilai rahasia yang di-hardcode; tes memastikan `JOBS_SECRET` tidak punya nilai bawaan yang tidak kosong.
- [x] Env kosong tidak membuka jalur tanpa autentikasi: dijamin oleh tes route yang sudah ada, `src/app/api/internal/jobs/run/route.test.ts` (bukan oleh PR ini).
- [x] `docker compose config` dengan env dummy berhasil (bukti di bawah).
- [x] Tes gagal bila kode server membaca env yang tidak diteruskan compose, untuk akses literal dan akses dinamis yang terdaftar (12 tes lulus).
- [x] Review `haiku`: tanpa temuan blocking atau should-fix; kompatibel dengan `ops/deploy.sh --env-file .env`.
- [x] Ratchet di baseline.

## Bukti `docker compose config`

Dijalankan lokal (Docker Compose v5.1.1) dengan `--env-file` berisi nilai
dummy untuk variabel wajib; exit 0. Keluaran relevan:

```
JOBS_SECRET: ""
MAIL_FROM: ""
PARTNERSHIP_TEAM_EMAIL: ""
SMTP_HOST: ""
SMTP_PASSWORD: ""
SMTP_PORT: "465"
SMTP_SECURE: ""
SMTP_USER: ""
```

(`MAIL_PROVIDER` tidak dikutip: shell sesi ini sudah mengekspor
`MAIL_PROVIDER=mock`, yang ikut terinterpolasi.)

## Langkah owner

Salin `docker-compose.prod.yml` terbaru ke host sebelum deploy.

## Catatan

- `docker-compose.yml` (dev) tidak meneruskan `JOBS_SECRET`; kandidat tiket
  terpisah.

## Comments

- 2026-10-02: tiket ditulis retroaktif oleh koordinator; pekerjaan dibangun sebelum tiket ada (gap alur). PR #185, commit ee85078.
- 2026-10-02: done. Merge ke main sebagai 993fdbb.
