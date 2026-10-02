# 02: Env jobs dan mail tidak diteruskan ke container app produksi

**Type:** bug (ditulis retroaktif)

**Status:** awaiting-merge

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
- Tes `src/__tests__/docker-compose-prod.test.ts` membaca env server yang
  dipakai `src/` dan gagal bila ada yang tidak diteruskan. Allowlist hanya
  `NODE_ENV` dan `*TEST_DATABASE_URL`; `NEXT_PUBLIC_*` dilewati.
- Di luar cakupan: env milik PR #161 dan #179; tes ini akan menangkapnya bila
  PR itu merge lebih dulu.

## Kriteria penerimaan

- [x] Kesembilan env diteruskan ke service `app` dengan nama yang sama dengan yang dibaca kode.
- [x] Tidak ada nilai rahasia yang di-hardcode; variabel kosong tidak membuka jalur tanpa autentikasi.
- [x] `docker compose config` dengan env dummy berhasil.
- [x] Tes gagal bila kode server membaca env yang tidak diteruskan compose (8 tes lulus).
- [x] Review `haiku`: tanpa temuan blocking atau should-fix; kompatibel dengan `ops/deploy.sh --env-file .env`.
- [x] Ratchet di baseline.

## Langkah owner

Salin `docker-compose.prod.yml` terbaru ke host sebelum deploy.

## Comments

- 2026-10-02: tiket ditulis retroaktif oleh koordinator; pekerjaan dibangun sebelum tiket ada (gap alur). PR #185, commit ee85078.
