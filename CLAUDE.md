# Fund for Indonesia

Platform social impact yang dioperasikan PT Jaya Korpora Prima. Domain model
ada di `CONTEXT.md`; keputusan arsitektur ada di `docs/adr/`.

## Agent skills

### Issue tracker

Issues dan spec hidup sebagai file markdown di `.scratch/<feature-slug>/`.
See `docs/agents/issue-tracker.md`.

### Triage labels

Lima peran default (`needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`), plus `done` untuk tiket yang sudah merge ke
`main`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: satu `CONTEXT.md` di root plus `docs/adr/`.
See `docs/agents/domain.md`.

### Alur spec -> implementasi

Repo ini **hanya** memakai skill `mattpocock-skills` 1.2.3, yang di-vendor ke
`.claude/skills/` (lihat README di sana) supaya cloud session memuatnya. Panggil
dengan nama polos (`tdd`, `code-review`, `grilling`, ...). Plugin workflow lain
(superpowers, feature-dev, specflow, dll.), termasuk plugin mattpocock-skills
itu sendiri, dimatikan di `.claude/settings.json`; jangan memanggil skill mereka
walau terpasang secara global. Urutannya:

1. **Intake**: `/grill-with-docs`, yang sekaligus memelihara `CONTEXT.md` dan ADR.
2. **Spec**: `/to-spec` menulis `.scratch/<feature-slug>/spec.md`.
3. **Bersyarat**: `/to-tickets` hanya bila kerjanya lintas sesi. Tiket ditulis
   ke `.scratch/<feature-slug>/issues/`, dikerjakan dengan urutan pemblokir
   lebih dulu.
4. **Eksekusi**: `/implement` per tiket (menjalankan `/tdd`, ditutup
   `/code-review`). `/clear` di antara tiket.
5. **Debug**: `/diagnosing-bugs`. **Laporan masuk**: `/triage`.
   **Kesehatan kode**: `/improve-codebase-architecture`.

**Verifikasi**: lewat CI, termasuk langkah full-suite `/implement`. Baca sebelum
menjalankan tes, merge, deploy, atau menghapus worktree. See `docs/agents/verification.md`.

## Sesi agent

Semua sesi Claude untuk proyek ini berjalan di **Claude Code cloud session**
(claude.ai/code atau `claude --cloud`), termasuk sesi koordinator. VPS hanya
untuk produksi dan ops yang dijalankan owner (nginx, cutover, backup).

- Owner menulis dalam Bahasa Indonesia; jawab dalam Bahasa Indonesia.
- Owner biasanya menjawab "ya" untuk mengikuti rekomendasi. Tetap minta
  persetujuan eksplisit untuk merge, perubahan setelan GitHub, dan apa pun yang
  menyentuh host produksi.
- Jangan pernah mengubah, men-deploy, atau menjalankan apa pun di
  `/home/ubuntu/kibi-clone` (checkout produksi yang live) atau stack produksi.
  Deploy hanya lewat `.github/workflows/deploy.yml`, di-dispatch owner.
- Repo di GitHub Free: tidak ada branch protection atau environment reviewer.
  Merge hanya setelah semua check CI hijau.
- Tidak ada kredensial asli di repo, termasuk `.scratch/`.

### Model subagent (anggaran token)

Selalu isi `model` saat men-dispatch subagent; jangan biarkan mewarisi model
sesi:

- Membangun kode (tiket, TDD), code review pertama, riset, prototipe: `sonnet`.
- Re-review yang hanya mengecek daftar perbaikan, sapuan dokumen, edit mekanis,
  pencarian kode: `haiku`.
- `opus` hanya untuk kode keamanan, uang, atau konkurensi yang sulit, bila
  `sonnet` gagal atau review terus menemukan pelanggaran berat.
- Diff kecil (di bawah ~300 baris, atau commit lanjutan): satu reviewer yang
  tetap melaporkan tiap sumbu review di bawah judulnya sendiri; diff besar tetap
  memakai reviewer paralel.
- Brief menunjuk path file, bukan menempel isi; minta laporan paling banyak
  ~200 kata.
- Cloud container punya 4 vCPU: paling banyak 3 subagent pembangun sekaligus
  per sesi. Untuk lebih banyak paralelisme, buka cloud session terpisah per
  tiket.
