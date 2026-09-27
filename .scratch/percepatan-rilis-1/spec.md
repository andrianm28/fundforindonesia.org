# Plan: percepatan Rilis 1 (Fase 0-2 penuh)

Status: ready-for-agent
Source: `/grill-with-docs` 2026-09-27, plus `docs/PRD-fund-for-indonesia.md`
§6 (Ruang lingkup rilis pertama) dan §7 (FFI-01 sampai FFI-18). Keputusan
owner ditulis di bagian "Decisions"; plan ini hanya menjadikannya urutan kerja.

## Ringkasan

Rilis pertama = **Fase 0 sampai 2** PRD §6. Di luar scope: Volunteer Trip
(FFI-11/12, kolom rilis 3), dwibahasa (FFI-15, kolom 3), Volunteer Trip,
dompet dan AutoDonation (dikecualikan tanpa jadwal).

Kode Fase 0-1 sudah hampir utuh di `main`. Yang belum ada adalah dua hal
yang **tidak bisa dikerjakan agent**: infra produksi (Track A) dan **jalur
keluar uang** (Track B: Payout, Manual Contribution, Usage Report).

Jadi saat ini bukan "kurang fitur". Itu adalah **jawaban**: satu-satunya
penghalang rilis adalah langkah manusia yang belum dijalankan, dan jalur
keluar uang yang belum dibangun.

## Decisions (2026-09-27)

- **Q1 - definisi rilis 1**: PRD §6 penuh (Fase 0-2), bukan potongan
  minimal. Payout dan Manual Contribution ikut di dalamnya.
- **Q2 - PR #68** (Verification Request per-Kind + change request):
  di-merge ke `main` sebagai `2c38a09`.
- **Q3 - Payout adalah syarat cutover, bukan Fase 2 yang bisa menyusul.**
  Platform yang menerima donasi publik tanpa jalur pencairanaduakan uang
  yang masuk tidak bisa keluar. Payout (FFI-07), Manual Contribution
  (FFI-07c) dan Usage Report (FFI-07a) adalah prasyarat menerima donasi
  nyata. Refund (FFI-07d) boleh menyusul: selama belum ada Payout
  otomatis, donasi bisa ditolak manual, dan itu berbeda dari money-out
  normal yang tidak bisa ditunda.
- **Q4 - dua lintasan paralel**: Track A (manusia, tanpa kode) dan Track B
  (agent, kode). Track A tidak menunggu kode sama sekali, jadi bisa
  dijalankan sekarang juga. Plan ini tidak menyerialkan keduanya.
- **Q5 - dependabot**: tiga major ditutup sebelum produksi live
  (framer-motion 13, tailwind 4, dotenv 18), karena tidak ada gunanya
  membawa rewrite dependency ke produksi yang belum pernah live dan
  menambah permukaan debugging saat cutover. #46 (minor/patch, 18 update)
  di-merge: menurunkan `npm audit` dari 18 ke 13 (critical 3 ke 2,
  moderate 7 ke 2). Sudah dilakukan, `de7de10`. Ini tidak bertentangan
  dengan FFI-18, karena FFI-18 adalah fitur penyedia pembayaran kedua,
  bukan upgrade dependency.

## Track A - langkah manusia (tanpa kode)

Tidak ada satu pun langkah di sini yang menunggu kode. Semua bisa
dikerjakan sekarang, paralel dengan Track B.

- **A1 - kredensial Sumopod untuk pembayaran.** QRIS nyata tidak bisa
  terjadi tanpa ini, dan gate Fase 1 justru "satu donasi QRIS nyata plus
  Receipt". Lihat `.scratch/percepatan-produksi/issues/01`.
- **A2 - SMTP Sumopod di production `.env`**: `MAIL_PROVIDER=smtp`,
  `SMTP_HOST=smtp.sumopod.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`,
  `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`. Tanpa ini, keputusan Verifier
  tetap berjalan tetapi email tidak terkirim dan `mail_not_configured`
  muncul di log.
- **A3 - repo secrets**: `DEPLOY_HOST`, `DEPLOY_SSH_KEY`,
  `DEPLOY_KNOWN_HOSTS` (dari `ssh-keyscan`, diverifikasi out-of-band).
  **Saat ini `gh secret list` kosong**, jadi deploy tidak mungkin jalan.
- **A4 - repo variables**: `NEXT_PUBLIC_BASE_URL=https://fundforindonesia.org`
  dan `NEXTAUTH_URL`. **Saat ini `gh variable list` kosong.**
- **A5 - copy `ops/deploy.sh` dan `docker-compose.prod.yml`** ke host
  (`DEPLOY_DIR`) dari commit yang akan dideploy. Deploy key tidak boleh
  menulis file; kalau sebuah release mengubah salah satu dari dua berkas
  itu, copy lebih dulu sebelum dispatch.
- **A6 - cutover**: `.scratch/ci-cd-github-actions/issues/08`
  (`ready-for-human`). Detail dan rollback ada di Comments tiket itu:
  declare volume `kibi-clone_postgres_data` dan `kibi-clone_uploads`
  sebagai `external: true`; backup wajib sebelum migration pertama;
  `kibi-clone-app:latest` (30a1c6dedfb9) adalah target rollback dan tidak
  boleh di-prune; hentikan stack kibi-clone sebelum `up` karena nama
  container dan port bentrok; `DB_PASSWORD` sudah diverifikasi bukan
  `changeme123`; cek Postgres local trust untuk `pg_dump`; hapus stopgap
  nginx `/_next/image` setelah cutover.
- **A7 - daftar YIEM** sebagai Collecting Entity beserta permit,
  **sebelum** deploy pertama (`.scratch/percepatan-produksi/issues/02`).
  Setelah deploy, setiap Campaign Active yang sudah ada menolak donasi
  sampai punya Collecting Entity dengan permit, jadi YIEM harus lebih dulu.
- **A8 - dispatch `deploy.yml`** setelah A1-A7 dan Track B Fase 2 selesai.

Setiap langkah dipecah jadi tiket di `track-a/` lewat `/to-tickets`.

## Risiko yang harus diketahui owner

**The approval control does not exist on GitHub Free.**
`.github/workflows/deploy.yml` dan `docs/agents/verification.md` menulis
bahwa job `deploy` "runs only once the owner approves it as that
environment's required reviewer", dan karena itu agent tidak akan pernah
menyetujui deploynya sendiri. Tapi environment `production` punya
`protection_rules: []` dan `reviewers: []`, dan GitHub Free tidak
menyediakan required reviewer untuk environment. Plannednya juga
sebenarnya "stay on GitHub Free, so the GitHub environment step is
dropped" (plan 2026-09-26).

Artinya: **siapa pun yang bisa menulis ke repo ini bisa dispatch
`deploy.yml`, dan job `deploy` akan jalan tanpa approval apa pun** begitu
gate hijau. Yang menjaganya hanya prosedur: hanya owner yang dispatch.
`ci/deploy-gate.sh` tetap menahan commit yang bukan main, tanpa CI hijau,
dan tanpa image GHCR yang cocok, jadi risikonya bukan malicious code
menjalankan sendiri, melainkan deploy yang bukan hasil yang disetujui.

Pilihan owner ada di `track-a/`: menerima kontrol prosedural, atau pindah
ke paket yang mendukung environment reviewer. Agent tidak akan mengubah
setelan GitHub tanpa persetujuan.

## Track B - kode (agent), urut berdasarkan pemblokir

1. **prd 34** Manual Contribution (FFI-07c), pemblokir 8 (done). Mencatat
   dana yang masuk di luar gateway, termasuk yang menunjuk Program dan
   dikreditkan ke Program Balance.
2. **prd 27** Payout completion (FFI-07), pemblokir 5 dan 8 (done). Aturan
   dua orang: orang yang menyetujui bukan peminta, dan yang menandai
   Completed harus berbeda dari yang menyetujui.
3. **prd 28** Fundraiser Payout UI (FFI-07), pemblokir 27.
4. **prd 29** Usage Report (FFI-07a), pemblokir 28. Wajib sebelum Payout
   berikutnya.
5. **prd 35** Collection account reconcile (FFI-07), pemblokir 27.
6. **prd 32** Refund lifecycle (FFI-07d), pemblokir 13, 31, 8. Dijadwalkan
   setelah Payout solid, sesuai Q3.
7. **csr 04, 05, 06, 07, 08, 10, 11** - FFI-09 (Portofolio CSR) dan
   FFI-10 (Diskusi kemitraan), plus checklist hibah. Pemblokir: prd-12
   (done) dan prd 34.
8. **prd 14** duplicate-campaign hints (FFI-05), pemblokir 12 (done).
9. **prd 23** guest-donor history (FFI-13), pemblokir 16 dan 18.
10. **prd 26** hide demo campaigns, pemblokir 25 (done).

Phase 2 lain (prd 36, 37, 40, 41, 42, 43, 44, 45) masih `ready-for-agent`
dan tidak masuk urutan atas karena bukan pemblokir jalur uang.

Volunteer Trip tidak masuk plan ini meski branch `feat/escrow-release`
masih ada: FFI-11/12 kolom rilisnya 3, bukan 0-2.

## Gate

- **Phase 0**: FFI-09, 10, 11, 13 sudah merged.
- **Phase 1**: Track A A1-A7 selesai, satu donasi QRIS nyata, Receipt
  diterima.
- **Phase 2**: rantai Payout (27, 28, 29) dan Manual Contribution (34)
  merged dan terverifikasi; Suspension (FFI-07b) sudah ada di
  `subject-guard-and-suspension-money`.

## Di luar scope

- Branch `feat/escrow-release` dan `worktree-agent-*`: dibiarkan, tidak
  dijadwalkan, tidak di-merge.
- Refund yang diminta sendiri oleh Donor (PRD §6, dikecualikan).
