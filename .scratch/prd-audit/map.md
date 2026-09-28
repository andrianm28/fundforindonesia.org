# Map: audit PRD dan workflow Matt skills

Effort wayfinder, dibuka 2026-09-28 lewat `/wayfinder`. Owner: Dri.

## Destination

Tiga hal untuk `main`, diukur terhadap PRD, ADR, `CONTEXT.md`, dan
`docs/integrasi-sumopod.md`:

1. **Matriks kepatuhan**: setiap requirement di seluruh PRD diberi ✅ / 🟡 / ❌ / ⚠️ beserta bukti `file:line`.
2. **Putusan Rilis 1** dalam dua baris: *siap kode* (bisa dikerjakan agent) dan *siap luncur* (menunggu langkah owner). Ukurannya definisi **Rilis 1** dan **Soft Launch** di `CONTEXT.md`.
3. **Spec celah** yang siap diteruskan ke `/to-spec`: setiap celah pada gerbang Fase 0–3, ditambah setiap ⚠️ dari fase mana pun.

Ditambah sumbu kedua: **kepatuhan workflow Matt skills** sejak diadopsi, dengan temuan dan perbaikannya.

Peta ini selesai saat triase celah (tiket 05) dan triase workflow (tiket 06)
resolved, dan spec-nya bisa diserahkan ke `/to-spec`.

## Notes

- Keputusan owner 2026-09-28, dari grilling Q1–Q11 dan Q10.1–Q10.9 di sesi koordinator:
  - Q1 (a)+(b)+(c); Q3 seluruh PRD; sumber = PRD + ADR + `CONTEXT.md` + integrasi Sumopod, dan bila PRD bertentangan dengan ADR, ADR yang lebih baru menang dan pertentangannya dicatat.
  - **Standar bukti**: requirement yang dijalankan pengguna baru ✅ bila ada di kode, ada tesnya, dan layarnya ditunjuk sesuatu (ukuran `rilis-1-benda/scorecard.md`). Aturan backend cukup kode + tes. Kode tanpa layar = 🟡. Setiap ✅/⚠️ pada kode uang dicek ulang koordinator sebelum masuk matriks.
  - **Rilis 1 = gerbang Fase 0–3** (lihat `CONTEXT.md`). Isi Fase 3 di luar gerbang dicatat di matriks, lalu diputuskan per item di tiket 05.
  - **Workflow**: artefak dan kebersihan dokumen diperiksa penuh, proses di commit disampel (10 PR uang terakhir), dan hanya sejak adopsi Matt skills (2026-09-26). Era Kiro/superpowers hanya dicatat sebagai latar.
- Versi hemat, atas permintaan owner: tiga tiket research per gerbang, satu untuk workflow. Agent `sonnet` baca-saja, paralel, tanpa menjalankan tes.
- Audit sebelumnya (`.scratch/prd-adr-gap-analysis/research.md`, commit `87cce13`) boleh dibaca sebagai petunjuk, **bukan** bukti; banyak yang sudah berubah.
- Jebakan yang wajib diingat: grep ke tree yang salah, dan "hijau" bukan "benar" (lihat `rilis-1-benda/handoff-2026-09-28.md`). Selalu baca `origin/main`.
- Skill yang dipakai: `research` untuk 01–04; `grilling` + `domain-modeling` untuk 05–06.
- Celah yang menyangkut alur uang dikirim ke peta `rilis-1-benda` sebagai tiket di sana, bukan diduplikasi di sini.

## Decisions so far

<!-- satu baris per tiket resolved -->

- **01** (resolved): Gerbang Fase 0 siap kode; Fase 1 🟡 siap kode karena Asset
  Waqf Inquiry (❌ nol kode) dan Guest Donor claim-by-email via verifikasi
  tautan (❌) belum ada. `.scratch/prd-audit/issues/01-fase-0-1-compliance.md`,
  bukti `.scratch/prd-audit/research/01-fase-0-1.md`.
- **02** (resolved): Gerbang Fase 2 tidak siap kode dan tidak siap luncur —
  tidak ada layar Payout, Usage Report nol kode, hanya satu penyedia
  pembayaran nyata. Dikoreksi: pengingat 30 hari Kind Authorisation adalah 🟡
  (`expiringWindows` di `src/lib/collecting-entity.ts:136`, ada tes), bukan
  ❌ seperti draf riset semula.
  `.scratch/prd-audit/issues/02-fase-2-compliance.md`, bukti
  `.scratch/prd-audit/research/02-fase-2.md`.
- **03** (resolved): Gerbang Fase 3 🟡 — jalur uang Trip Fee lengkap di API
  tapi tanpa satu layar pun dan sertifikat nol kode (❌); ⚠️ Trip Fee tidak
  punya `donationsEnabled()`/`sandboxInProductionReason()` seperti Donation.
  Item Fase 3 di luar gerbang semuanya belum dimulai, jadi bahan tiket 05.
  `.scratch/prd-audit/issues/03-fase-3-compliance.md`, bukti
  `.scratch/prd-audit/research/03-fase-3.md`.
- **04** (resolved): Dua temuan HIGH (review independen tidak tercatat di
  GitHub untuk 10 PR uang terakhir; tiket 35 mengklaim PR yang tidak pernah
  merge) plus MEDIUM/LOW/INFO lain. Dikoreksi: untuk PR #121 review
  independen memang dijalankan koordinator, hanya hasilnya tidak diposting
  ke PR — celahnya jejak audit, bukan review yang dilewati.
  `.scratch/prd-audit/issues/04-matt-workflow-compliance.md`, bukti
  `.scratch/prd-audit/research/04-workflow.md`.

## Not yet specified

- Bentuk akhir spec untuk `/to-spec`: satu spec per gerbang atau satu spec gabungan. Baru bisa dijawab setelah jumlah celahnya terlihat.

## Out of scope

- Mengukur metrik PRD §5 terhadap angka nyata. Rilis 1 hanya menuntut metriknya *bisa diukur* (keputusan Q10.4); nilainya baru ada setelah Soft Launch.
