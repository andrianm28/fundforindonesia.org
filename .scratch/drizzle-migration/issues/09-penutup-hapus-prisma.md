# 09: Penutup, runner migrasi dan hapus Prisma

**Blocked by:** 08

**Status:** needs-triage

- [ ] Runner migrasi yang menerapkan `prisma/migrations/*/migration.sql` dan mencatat di `_prisma_migrations` yang sudah ada (atau `drizzle-kit migrate` dengan baseline yang menandai 95 migrasi lama sudah jalan). Dibuktikan: DB kosong termigrasi sama persis; DB salinan produksi tidak menjalankan ulang apa pun.
- [ ] Hapus `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `@auth/prisma-adapter`, `prisma.config.ts`, `src/generated/prisma`, `src/lib/prisma.ts`.
- [ ] Dockerfile tahap `migrate`, `docker-compose.prod.yml`, `docker-compose.staging.yml`, CI, `ci/local.sh`, hook sesi, dan dokumen diperbarui.
- [ ] Prompt deploy baru di file proyek untuk agent server owner, dengan langkah rollback ke image Prisma terakhir.
- [ ] Butuh persetujuan eksplisit owner untuk merge dan deploy.
