# 01: Fondasi Drizzle berdampingan dengan Prisma

**Blocked by:** None

**Status:** ready-for-human (PR terbuka)

- [ ] `drizzle-orm@0.45.4` (dependency) dan `drizzle-kit@0.31.11` (devDependency), dipin persis tanpa `^`.
- [ ] `drizzle.config.ts`; skema di `src/db/schema.ts` dihasilkan `drizzle-kit pull` dari DB hasil `prisma migrate deploy`, dirapikan per domain. Tidak ada `push`/`generate` migrasi.
- [ ] `src/db/index.ts`: `db` dari `drizzle-orm/node-postgres` dengan satu `Pool` bersama, di-cache di `globalThis` seperti `src/lib/prisma.ts`; mock build dengan perilaku sama bila `DATABASE_URL` kosong/dummy.
- [ ] Cek paritas di CI: tes DB-asli yang memeriksa tiap tabel, kolom (tipe, nullability), enum (nilai dan urutan), check, foreign key, dan index lewat katalog Postgres terhadap skema Drizzle. Gagal bila menyimpang.
- [ ] Tes: satu query Drizzle dan satu query Prisma membaca baris yang sama di DB tes; `LedgerEntry_amount_positive` tampil di skema Drizzle.
- [ ] Belum ada call site yang dipindah.

## Comments

2026-11-28: dikerjakan. `drizzle-kit pull` tidak bisa membaca kembali dua check NOT VALID dan kolom array enum; keduanya dikoreksi tangan dan dicatat di kepala `src/db/schema.ts`. Cek paritas dibuat sebagai tes DB-asli (`src/db/schema-parity.test.ts`), bukan diff `drizzle-kit pull`, karena diff itu berisik oleh kekurangan yang sama. Prisma kini memakai pool `pg` yang sama (`src/db/pool.ts`).
