# Plan: percepatan Rilis 1

Status: **basi — ditulis ulang 2026-09-28, versi sebelumnya dibuang**
Source: `/grill-with-docs` 2026-09-27, plus `docs/PRD-fund-for-indonesia.md` §6
(halaman rilis pertama) dan §7 (FFI-01 sampai FFI-18).

> **Kenapa ditulis ulang, bukan diperbarui.** Versi sebelumnya disusun 2026-09-27
> dan 14 item-nya sudah tidak berlaku. Yang paling berbahaya: ia mencantumkan
> PR #93 dan #94 sebagai "hijau, tinggal merge" padahal keduanya **tertinggal
> 4 dan 9 commit** dari `main` sekarang, dan PR #94 sudah berstatus `DIRTY`.
> Menjalankan plan versi itu berarti membangun di atas base yang salah. Semua
> status di bawah diverifikasi terhadap `git log origin/main` dan `gh pr`, bukan
> terhadap baris `Status:` di tiket — peta sudah memperingatkan bahwa `done`
> pernah ditemukan pada tiket yang PR-nya belum merge.

## Ringkasan

Rilis pertama = Fase 0 sampai 2 PRD §6. Di luar scope: dwibahasa (FFI-15, kolom
rilis 3), dompet dan AutoDonation (dihapus sengaja), mobile app, sertifikat
blockchain.

Yang sudah untung: **empat bug uang tertutup dan merged pada 2026-09-27**, dan
semuanya bisa dibuktikan:

| Commit | Yang ditutup |
| --- | --- |
| `f97c96e` | `runScheduledJobs` tidak punya pemanggil — escrow hanya lepas saat Payout diminta, reminder tidak pernah terkirim |
| `703d692` | Sweep escrow memakai net tanpa Platform Fee — ESCROW_HOLD negatif, uang platform masuk saldo yang bisa di-Payout |
| `fc2d256` | Gate Refund zakat/wakaf/hibah tidak ada sama sekali padahal ADR 0013 menyatakan sudah terverifikasi |
| `a043455` | `completePayout` tidak mengecek `verifiedAt` — completion adalah uang yang benar-benar keluar |

Jadi penghalang rilis **bukan lagi "kurang fitur"**. Itu adalah jawabannya:
penghalang yang tersisa adalah kode yang belum ditulis, keputusan yang belum
diambil, dan langkah manusia.

## Track A — langkah manusia, tanpa kode

Tidak satu pun menunggu kode. Bisa dijalankan sekarang, paralel dengan Track B.

- **A1** — kredensial Sumopod produksi (QRIS). `.scratch/percepatan-produksi/issues/01`
- **A2** — SMTP Sumopod di production `.env`: `MAIL_PROVIDER=smtp`, `SMTP_HOST=smtp.sumopod.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`. Tanpa ini keputusan Verifier berjalan tetapi email tidak terkirim.
- **A3** — repo secrets: `DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`. **`gh secret list` masih kosong** per 2026-09-28, jadi deploy tidak mungkin jalan.
- **A4** — repo variables: `NEXT_PUBLIC_BASE_URL=https://fundforindonesia.org`, `NEXTAUTH_URL`. **`gh variable list` masih kosong.**
- **A5** — **`JOBS_SECRET`** untuk `POST /api/internal/jobs/run`. Route-nya sudah ada di `main` (`f97c96e`) dan **fail-closed**: tanpa secret ia menjawab 503 dan menolak semua job. Sampai secret di-set, escrow masih macet dan reminder masih diam.
- **A6** — **cron di host** yang memanggil route itu. Pertanyaan yang dijawab builder dan belum diserahkannya ke owner: schedule-nya **host cron, bukan GitHub Actions** — Actions punya uptime, GitHub mematikan schedule setelah 60 hari idle, dan run yang hilang menunda escrow yang sudah matang. Instruction persisnya ada di `.scratch/prd-compliance-fase-0-2/issues/45-scheduled-jobs-trigger.md` (`ready-for-human`).
- **A7** — copy `ops/deploy.sh` dan `docker-compose.prod.yml` ke host sebelum dispatch pertama, kalau release mengubah salah satunya.
- **A8** — daftar YIEM sebagai Collecting Entity beserta permit, **sebelum** deploy pertama. `.scratch/percepatan-produksi/issues/02`
- **A9** — cutover. `.scratch/ci-cd-github-actions/issues/08` (`ready-for-human`), termasuk declare volume `kibi-clone_postgres_data` dan `kibi-clone_uploads` sebagai `external: true`, backup sebelum migration pertama, `kibi-clone-app:latest` (30a1c6dedfb9) sebagai target rollback yang tidak boleh di-prune, dan hentikan stack kibi-clone sebelum `up` karena nama container dan port bentrok.

## Track B — kode, urut berdasarkan pemblokir

Urutan ini **berbeda dari versi sebelumnya** dan alasannya bisa diperiksa.

### 1. `prd 35` — reconcile (PR #93, terbuka, CLEAN, **29 commit belum ter-merge**)

Sudah ditulis dan ter-review, dan **tidak menyentuh kode uang** — empat fix di
`src/lib/money/` sudah ter-merge dan tidak bersinggungan dengan diff-nya.

Tapi angka versi sebelumnya ("hijau, tinggal merge", "4 commit tertinggal")
**salah**, dan cukup salah untuk menyesatkan. Branch ini dibuat jauh sebelum
`main` bergerak, jadi tercatat **29 commit belum ter-merge** dengan `main`
sudah 5 commit di depan. Rebase sederhana akan mengembalikan
`prisma/schema.prisma` ke versi sebelum koreksi `GATEWAY_CLEARING`, karena
kedua branch menyentuh baris yang sama dan yang pertama di-apply menang.

Cara yang benar sudah dicoba: cherry-pick 27 commit non-merge ke atas `main`
berhasil **tanpa konflik**, menghasilkan 39 file / +4.387 / −138 yang identik
dengan merge-base branch itu sendiri, dengan 29 berkas test hijau dan 8 skipped.
Sisanya: rebase ke `main` **terbaru** (konflik di commit pertama), CI, merge.

### 2. Bank Account — kode yang belum ada sama sekali

**Ini penghalang sebenarnya, dan versi plan sebelumnya tidak tahu.**

`bankAccount.create` **tidak ada di `src/`**; satu-satunya penulisnya
`prisma/seed.ts`. Keputusan desainnya sudah diambil pada 2026-09-27 — tiket 01,
[ADR 0018](../../docs/adr/0018-bank-account-born-unverified-verified-by-request.md)
— dan `CONTEXT.md` sudah memuat terminologinya. Yang belum ada adalah kode:
membuat rekening tanpa `verifiedAt` di profil pemiliknya, dan me-referensikannya
dari Verification Request.

Sampai ini ada, **Payout tidak bisa membayar siapa pun.** PR #94 menulis layar
yang tidak bisa dibuka siapa pun.

### 3. `prd 28` — Payout UI (PR #94, terbuka, DIRTY, tertinggal 9 commit)

Menulis layar pencairan Fundraiser. **DIRTY**: harus rebase ke `main` dan CI
ulang. Merge **setelah** Bank Account ada, kalau tidak yang ter-merge adalah
layar mati.

Ada satu konsekuensi yang harusAlongside dipertimbangkan: menghapus sweep escrow
dari jalur baca membuat **halaman dengan saldo nol tidak merender form sama
sekali**, sehingga tidak ada POST, sehingga sweep tidak jalan. Tickets 10 dan
11 di `.scratch/rilis-1-benda/` menguraikannya.

### 4. Panel Admin Payout (PR #95, CLEAN, draft)

`approvePayout` dan `completePayout` ada dan menegakkan aturan dua orang, dan
**tidak ada layar di `src/app/admin` yang memanggilnya** — hanya
`/api/admin/reconcile` yang menyebutnya sebagai consumer. Payout yang dikirim
melalui produk akan tetap `PENDING`. Enam route Admin lain juga tanpa layar:
`reconcile`, `scrutiny`, `platform-fee`, `manual-contributions`,
`abuse-thresholds`, `duplicate-similarity`.

### 5. `prd 29` — Usage Report (belum ada)

`model UsageReport` **tidak ada di `prisma/schema.prisma`**, dan tidak ada
kodenya. Ini yang menahan **Payout kedua** — FFI-07a mewajibkannya sebelum
Payout berikutnya boleh diajukan. Payout pertama bisa jalan tanpanya, jadi ini
tidak memblokir gate Fase 1.

### 6. `prd 32` — Refund lifecycle, setelah `prd 31` (Refund gross ledger)

`prd 31` belum dimulai. Pemblokir "8" berstatus `wontfix`. Refund boleh
menyusul: selama belum ada Payout otomatis, donasi bisa ditolak manual, dan itu
berbeda dari money-out normal.

## Keputusan yang belum diambil, dan memblokir

Urutan Track B **tidak bisa difinalkan** tanpa ini:

- **`rilis-1-benda/02`** — di mana saldo provider dicatat, dan apakah selisihnya
  jadi gerbang atau hanya observasi. **Ini memblokir `approvePayout` secara
  langsung**, jadi ia bukan antrean belakang.
- **`rilis-1-benda/03`** — dokumen di mana dan siapa yang boleh melihatnya.
  Memblokir checklist §7.1 dan foto Usage Report.baru saja diblokir oleh 01.
- **`rilis-1-benda/05`** — apa yang dilihat orang yang memegang dua assignment.
  Membentuk setiap halaman.
- **`rilis-1-benda/11`** — apa yang mencabut verifikasi Bank Account. Ticket 11
  ada karena keputusan 01 memilih memverifikasi rekening yang ditunjuk sebagai
  kontrol kompensatorinya, dan kontrol yang hanya bisa dipakai satu arah bukan
  kontrol.
- **`rilis-1-benda/12`** — kapan nomor rekening didekripsi. ADR 0012 tidak punya
  HMAC, jadi membaca nomor adalah kejadian satu arah yang tidak bisa dibuktikan
  belakangan; kalau Sumopod tetap tanpa disbursement API, nomornya mungkin
  tidak perlu sampai ke platform sama sekali.

## Gate

- **Fase 0** — FFI-09, 10 sudah merged. **FFI-13 belum** (prd 23 tidak punya PR;
  pemblokir 16 dan 18 sudah merged, jadi tidak terhalang).
- **Fase 1** — Track A A1–A8 selesai, satu donasi QRIS nyata, Receipt diterima.
- **Fase 2** — rantai Payout merged dan terverifikasi, Bank Account bisa dibuat, panel Admin ada, `prd 29` merged.

## Risiko yang harus diketahui owner

**The approval control does not exist on GitHub Free.** `deploy.yml` dan
`docs/agents/verification.md` menulis bahwa job `deploy` hanya jalan setelah
owner menyetujuinya sebagai required reviewer environment, dan karena itu agent
tidak akan pernah menyetujui deployment-nya sendiri. Tapi environment
`production` punya `protection_rules: []` dan `reviewers: []`, dan GitHub Free
tidak menyediakan required reviewer untuk environment.

Artinya: **siapa pun yang bisa menulis ke repo ini bisa dispatch `deploy.yml`,
dan job itu akan jalan tanpa approval apa pun** begitu gate hijau. Yang
menjaganya hanya prosedur. `ci/deploy-gate.sh` tetap menahan commit yang bukan
`main`, tanpa CI hijau, dan tanpa image GHCR yang cocok, jadi risikonya bukan
malicious code menjalankan sendiri, melainkan deploy yang bukan hasil yang
disetujui. Agent tidak akan mengubah setelan GitHub tanpa persetujuan.

**Dan sekarang Route A5 menambah permukaan tanpa login.** `POST
/api/internal/jobs/run` memindahkan uang dan mengirim email, dijaga
`JOBS_SECRET` dengan perbandingan constant-time, dan menolak 503 bila secret
tidak di-set. Itu benar. Tapi secret itu **bergantung pada satu header**,
sehingga siapa pun yang mendapatkannya bisa memicu sweep kapan saja. Tidak
bahaya besar — sweep-nya idempoten — tapi bukan otentikasi, dan tidak boleh
dib gruesome seperti yang lain.

## Yang masih salah di dokumen kita sendiri

Empat dokumen menyatakan sesuatu yang tidak ada kodenya. Semuanya akan
membingungkan pembaca, dan `Dormant Balance` yang paling berbahaya karena
orang akan **berhenti mengejar saldo terlantar** tanpa melihat error:

- `CONTEXT.md:240` **Dormant Balance** menulis present tense "Muncul di laporan
  Admin sejak 60 hari" — nol baris `dormant` di `src/`, dan
  `scheduled-jobs.ts:31-34` justru menyatakan belum dibangun.
- `CONTEXT.md:205` menyatakan Provider Balance tercatat "**per penyedia**" —
  `GATEWAY_CLEARING` satu enum member tanpa diskriminator. ADR 0006 dan 0011
  justru menyatakan ini belum.
- `ADR 0006:12` "the current webhook hardcodes a zero provider fee" — sudah
  dibaca dari payload (`sumopod-provider.ts:234`).
- `ADR 0005:7` "the code today ranks roles DONOR < CAMPAIGN_CREATOR < MODERATOR
  < ADMIN" — `MODERATOR` sudah tidak memberi wewenang.

Satu kontradiksi dokumen yang **belum** terselesaikan: ADR 0013 dan PRD §196
menyatakan gate Refund zakat/wakaf/hibah sebagai fakta berjalan, sementara
PRD §323 menundanya ke Fase 2. Kode sekarang sudah ada (`fc2d256`), jadi
PRD §196 yang usang, bukan kodenya.

## Di luar scope

- Branch `feat/escrow-release` dan `worktree-agent-*`: tidak dijadwalkan.
- Refund yang diminta sendiri oleh Donor (PRD §6).
- Widget marketplace, integrasi sistem akuntansi, motion peng Incentif otomatis.
