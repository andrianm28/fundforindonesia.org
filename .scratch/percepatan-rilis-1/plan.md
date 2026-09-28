# Plan: percepatan Rilis 1

Status: **aktif — ditulis ulang 2026-09-28 sore** setelah owner memperluas Rilis 1.
Versi pagi hari ini (Rilis 1 = Fase 0–2, dwibahasa di luar scope) ada di riwayat
git; **jangan** dipakai lagi.

Source: grilling Q10.1–Q10.9 di sesi koordinator 2026-09-28, `CONTEXT.md`
(**Rilis 1**, **Soft Launch**), PRD §11, peta `rilis-1-benda`, dan peta
`prd-audit`.

## Yang berubah

- **Rilis 1 = gerbang Fase 0, 1, 2, dan 3** PRD §11, termasuk Volunteer Trip
  dengan Trip Fee nyata, satu Refund Trip Fee, dan sertifikat.
- **Soft Launch** diizinkan begitu gerbang Fase 2 lolos: Donation sampai ke
  rekening bank terverifikasi lewat Payout tanpa akses basis data. Gerbang Fase
  3 butuh Trip Fee *nyata*, jadi platform memang harus sudah live sebelum
  gerbang itu bisa lolos.
- **Penyedia kedua** (VA, e-wallet, disbursement) ikut, karena gerbang Fase 2
  menuntut Payment dua penyedia terekonsiliasi. Pilihannya menjadi tiket
  research `rilis-1-benda/issues/18`.
- Isi Fase 3 di luar gerbang (versi Inggris, WhatsApp, tautan pendek, impor
  settlement otomatis, pengalihan Dormant Balance, Refund oleh Donor, anggota
  tim) **tidak** ikut otomatis; diputuskan per item di `prd-audit/issues/05`.
- Tiket 16 (Bank Account) **merged** di PR #121. Satu dari dua pemblokir layar
  Payout sudah hilang; yang tersisa adalah empty state picker (tiket 17).

## Jalur kritis

Bukan kode. Jalur kritisnya adalah:

1. **Langkah owner (Track A)**: tidak satu pun bisa dikerjakan agent, dan Soft
   Launch mustahil tanpanya.
2. **Sepuluh keputusan grilling yang terbuka** di `rilis-1-benda` (02–05, 07,
   11–15, 17). Builder hanya bisa bergerak secepat keputusan turun.

## Tiga pengungkit

1. **Grilling borongan.** Semua tiket grilling terbuka disusun dalam satu ronde
   dengan rekomendasi di
   `.scratch/rilis-1-benda/grilling-borongan-2026-09-28.md`. Owner boleh
   menjawab banyak tiket dalam satu pesan (`docs/agents/issue-tracker.md`);
   tiap jawaban tetap dicatat di tiketnya sendiri.
2. **Track A paralel sekarang**, dibantu satu skrip `/wizard` supaya langkahnya
   tidak dijelaskan ulang ke agent tiap kali.
3. **Builder tidak menjalankan full suite lokal.** Tes terkait + tsc + lint di
   worktree, full suite di CI. Batas "satu full suite pada satu waktu" di
   `AGENTS.md` tidak lagi mencekik empat builder paralel.

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

Tambahan paling mendesak: **A0 — required reviewer untuk environment
`production`.** `protection_rules: []` hari ini, jadi deploy bisa jalan tanpa
persetujuan owner, dan komentar `deploy.yml:17-19` yang mengklaim sebaliknya
tidak benar sampai ini dipasang.

## Track B — kode, empat lajur (maksimal 4 agent)

| Lajur | Isi, urut pemblokir | Gerbang |
| --- | --- | --- |
| **L1 Uang keluar** | tiket 17 (empty state picker) → #114 layar Payout → #95 layar admin Payout → Usage Report dan gating-nya | Fase 2 |
| **L2 Admin** | pekerjaan Admin yang sudah ada kodenya tanpa layar (scorecard: 2 dari 13 terjangkau), satu layar per tiket | Fase 2 |
| **L3 Volunteer** | Trip, Batch, dan Registration bisa dijangkau di kedua ujung → Trip Fee nyata → Refund Trip Fee → sertifikat | Fase 3 |
| **L4 Research + audit** | tiket 18 penyedia kedua; `prd-audit` 01–04 | Fase 2 dan 3 |

L1–L3 dimulai per tiket begitu keputusan grilling yang memblokirnya turun dan
barisnya `Blocked by` semuanya `done`. L4 baca-saja dan bisa jalan sekarang.

Aturan yang tetap berlaku: kode uang selalu mendapat review independen
`sonnet`; cek carry-trap (`git diff --name-only origin/main <branch>`) sebelum
setiap merge; merge hanya dengan "ya" eksplisit dari owner.

## Gerbang

| Gerbang | Bukti | Status 2026-09-28 |
| --- | --- | --- |
| Fase 0 | Satu Campaign lolos Verification Request dan tampil tanpa intervensi basis data | diukur di `prd-audit/issues/01` |
| Fase 1 | Donasi QRIS nyata pertama end to end dan Receipt diterima | tertahan Track A (A1, A2, A8, A9) |
| **Fase 2 → Soft Launch** | Payout dan Usage Report tanpa intervensi basis data; Payment dua penyedia terekonsiliasi | L1, L2, tiket 18 |
| Fase 3 → Rilis 1 selesai | Volunteer Trip sampai sertifikat, satu Batch dengan Trip Fee nyata, satu Refund Trip Fee | L3; butuh Soft Launch |

## Urutan minggu ini

1. **Hari ini (agent):** dokumen ini, glosarium `CONTEXT.md`, peta
   `prd-audit`, tiket 18, dan grilling borongan, dalam satu PR dokumen.
2. **Owner:** jawab grilling borongan; pasang A0; jalankan wizard Track A.
3. **Agent:** dispatch L4 (baca-saja) segera setelah PR ini merge; L1–L3 per
   tiket begitu keputusannya turun.
