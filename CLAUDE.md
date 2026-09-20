# Fund for Indonesia

Platform social impact yang dioperasikan PT Jaya Korpora Prima. Domain model
ada di `CONTEXT.md`; keputusan arsitektur ada di `docs/adr/`.

## Agent skills

### Issue tracker

Issues dan spec hidup sebagai file markdown di `.scratch/<feature-slug>/`.
See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: satu `CONTEXT.md` di root plus `docs/adr/`.
See `docs/agents/domain.md`.

### Alur spec -> implementasi

Repo ini memakai alur spec specflow untuk intake, lalu menyerahkannya ke
Superpowers untuk implementasi. Urutannya:

1. **Intake**: ketik `/specflow:grill-with-docs`. Fase ini user-invoked: sesi grilling
   dimulai saat kamu mengetiknya, dan ia sekaligus memelihara `CONTEXT.md` dan ADR.
2. **Spec**: `/specflow:to-spec` menulis ke `.scratch/<feature-slug>/spec.md`
   (lokasi yang dicatat `docs/agents/issue-tracker.md`).
3. **Bersyarat**: `/specflow:to-tickets` hanya bila kerjanya lebih besar dari satu
   rencana, atau bentuknya wide refactor. Untuk kerja yang muat satu rencana,
   lewati: `superpowers:writing-plans` sudah memecahnya jadi task, dan
   menjalankan keduanya adalah dekomposisi ganda.
4. **Rencana**: `/specflow:spec-to-plan` — **satu panggilan, prosedur sembilan langkah**.
   Ia sendiri yang memanggil `superpowers:using-git-worktrees` untuk membuat
   workspace terisolasi (ia menjalankan baseline test dan melapor bila merah,
   bukan menjamin hijau), lalu
   `superpowers:writing-plans` untuk menulis dokumennya, lalu menyisipkan
   kendala seam ke tiap blok task dan menjalankan skrip penjaga. Jangan
   memanggilnya dua kali.
5. **Eksekusi**: `superpowers:subagent-driven-development`.
6. **Review**: `/specflow:code-review` (dua sumbu). **Debug**: `/specflow:diagnosing-bugs`.
7. **Penutup**: `superpowers:finishing-a-development-branch` — verifikasi test,
   pilih di antara tiga opsi yang disajikannya, bersihkan worktree. Membuang
   kerja hanya atas permintaan eksplisit, bukan opsi menu.
