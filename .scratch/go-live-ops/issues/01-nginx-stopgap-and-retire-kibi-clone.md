# 01: Stopgap nginx dan pensiun checkout kibi-clone

**What to build:** Sisa pekerjaan dari ci-cd 08 (`ci-cd-github-actions/issues/08-host-setup-and-cutover.md`), yang ditutup `done` pada 2026-10-04 karena produksi sudah berjalan dari image repo ini. Dua hal tersisa, keduanya langkah owner di host dan tanpa kode:

1. **Stopgap nginx `/_next/image`.** Blok sementara ini dipasang saat cutover. Sesi VPS 2026-10-04 memastikan ia tidak berbahaya (aplikasi memakai `images.unoptimized`), jadi boleh dibiarkan. Keputusan owner: biarkan, atau hapus di jendela perawatan berikutnya (cadangan konfigurasi nginx dibuat saat cutover).
2. **Pensiun checkout `kibi-clone`.** Tunggu sampai sekitar 2026-10-10 (satu minggu setelah cutover stabil, sesuai langkah 5 di ci-cd 08), lalu putuskan: hentikan sisa stack lama, arsipkan checkout, dan bersihkan sisa cutover (worktree cutover, berkas cadangan compose lama). Image lama `kibi-clone-app` tetap menjadi target rollback sampai keputusan ini diambil.

**Bahaya yang harus dibaca dulu:** data produksi hidup di Docker volume yang diberi nama dengan awalan `kibi-clone_` (database dan uploads), dideklarasikan `external: true` di compose produksi. Pensiun checkout **tidak boleh** menghapus volume itu: jangan `docker compose down -v`, dan jangan `docker volume prune` sebelum memastikan tidak ada volume produksi yang ikut. Pastikan backup malam dan salinan offsite terbaru ada dan restore drill sudah lulus (`docs/runbooks/restore.md`) sebelum menyentuh apa pun. Host juga menjalankan stack lain yang tidak boleh disentuh. Agent tidak mengerjakan tiket ini; semua langkahnya di host produksi.

**Blocked by:** None (langkah 2 menunggu sekitar 2026-10-10)

**Status:** ready-for-human

- [ ] Keputusan stopgap nginx dicatat di Comments: dibiarkan atau dihapus
- [ ] Backup terbaru dan salinan offsite diverifikasi sebelum pensiun
- [ ] Stack `kibi-clone` lama sudah berhenti dan checkout-nya diarsipkan atau dihapus, dengan volume produksi tetap utuh
- [ ] Sisa cutover (worktree, berkas cadangan compose lama) dibersihkan
- [ ] Image rollback lama dilepas hanya setelah keputusan ini, bukan sebelumnya

## Comments

- 2026-10-04 (percepatan-full-rilis, Track D): dibuat dari sisa ci-cd 08. Tidak ada IP, hostname, atau path server di tiket ini karena repo ini publik; nilainya ada pada owner. Rencana induk: `.scratch/percepatan-full-rilis/plan.md`, langkah A1.5 dan A1.9.
