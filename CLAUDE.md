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

Repo ini **hanya** memakai skill Matt Pocock dari plugin official **Skills For
Real Engineers** (Anthropic Directory, 1.2.3), yang diaktifkan owner di akun
claude.ai dan tersinkron ke cloud session. Skill plugin ber-namespace ID plugin:
`58da2c13-5ed4-4485-9625-fb87b369e6b4:<skill>` (mis. `...:tdd`,
`...:code-review`); di bawah ditulis dengan nama pendek. Salinan vendored di
`.claude/skills/` hanya cadangan sampai plugin terbukti termuat di cloud session
baru, lalu dihapus; bila keduanya ada, pakai versi plugin. Plugin workflow lain
(superpowers, feature-dev, specflow, dll.) dimatikan di `.claude/settings.json`;
jangan memanggil skill mereka walau terpasang secara global. Urutannya:

1. **Intake**: `/grill-with-docs`, yang sekaligus memelihara `CONTEXT.md` dan ADR.
2. **Spec**: `/to-spec` menulis `.scratch/<feature-slug>/spec.md`.
3. **Bersyarat**: `/to-tickets` hanya bila kerjanya lintas sesi. Tiket ditulis
   ke `.scratch/<feature-slug>/issues/`, dikerjakan dengan urutan pemblokir
   lebih dulu.
4. **Eksekusi**: `/implement` per tiket (menjalankan `/tdd`, ditutup
   `/code-review`). `/clear` di antara tiket.

Skill yang ber-`disable-model-invocation` (`implement`, `to-tickets`,
`to-spec`, `grill-with-docs`, `triage`, `handoff`, `wayfinder`, `ask-matt`,
dll.) hanya bisa diketik owner; agent tidak bisa memanggilnya. Keputusan owner
2026-09-26: saat agent yang mengerjakan, builder memanggil `tdd` lalu
`code-review` langsung (keduanya boleh dipanggil agent) dan menutup dengan full
suite + ratchet; koordinator menulis file tiket langsung di `.scratch/` mengikuti
`docs/agents/issue-tracker.md` alih-alih `/to-tickets`.
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
- Hanya owner yang men-dispatch `.github/workflows/deploy.yml`, dan owner juga
  satu-satunya required reviewer environment `production`; `main` dilindungi
  branch protection (keputusan owner 2026-10-04, ci-cd 25: "A + reviewer +
  protection"). Agent, termasuk koordinator, tidak pernah men-dispatch maupun
  menyetujui deploy.
- Merge hanya setelah semua check CI hijau.
- Tidak ada kredensial asli di repo, termasuk `.scratch/`.

### Model agent

Tiering model, dispatch, dan review: @AGENTS.md
