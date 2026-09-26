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

Repo ini **hanya** memakai skill dari plugin `mattpocock-skills`. Plugin
workflow lain (superpowers, feature-dev, specflow, dll.) dimatikan untuk proyek
ini di `.claude/settings.json`; jangan memanggil skill mereka walau terpasang
secara global. Urutannya:

1. **Intake**: `/grill-with-docs`, yang sekaligus memelihara `CONTEXT.md` dan ADR.
2. **Spec**: `/to-spec` menulis `.scratch/<feature-slug>/spec.md`.
3. **Bersyarat**: `/to-tickets` hanya bila kerjanya lintas sesi. Tiket ditulis
   ke `.scratch/<feature-slug>/issues/`, dikerjakan dengan urutan pemblokir
   lebih dulu.
4. **Eksekusi**: `/implement` per tiket (menjalankan `/tdd`, ditutup
   `/code-review`). `/clear` di antara tiket.
5. **Debug**: `/diagnosing-bugs`. **Laporan masuk**: `/triage`.
   **Kesehatan kode**: `/improve-codebase-architecture`.

**Verifikasi lewat CI, bukan di host bersama**: lokal hanya `npx vitest run
<file>` yang relevan; langkah full-suite `/implement` dijalankan CI lewat PR,
merge setelah hijau, deploy hanya lewat job CD yang disetujui. See
`docs/agents/verification.md`.
