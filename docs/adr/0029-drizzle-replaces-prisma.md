---
status: accepted
---

# Drizzle ORM menggantikan Prisma, bertahap, tanpa mengubah skema produksi

Keputusan owner (andrianm28) 2026-11-28: akses data pindah dari Prisma ke Drizzle ORM. Riset hari yang sama ([`riset-sveltekit-elysia-drizzle-ffi-2026-11-28.md`](/mnt/project-files/riset/riset-sveltekit-elysia-drizzle-ffi-2026-11-28.md), file proyek, bukan repo) menyarankan tetap di Prisma; owner memutuskan bermigrasi. ADR ini tidak mengulang perdebatannya, tetapi mencatat risikonya supaya tiap tiket menjaganya.

## Keputusan

- **Skema database tidak berubah karena migrasi ini.** Skema Drizzle (`src/db/schema.ts`, relasi di `src/db/relations.ts`) dihasilkan dengan `drizzle-kit pull` dari database yang sudah dimigrasi oleh `prisma/migrations`, lalu dirapikan dengan tangan. Tidak ada `drizzle-kit push` dan tidak ada migrasi yang dihasilkan ulang. Nama tabel, kolom, enum, constraint (termasuk `LedgerEntry_amount_positive`) dan index tetap persis seperti di produksi.
- **Prisma tetap pemilik migrasi sampai tiket terakhir.** Selama masa transisi, `prisma/migrations` dan `prisma migrate deploy` tetap satu-satunya jalur perubahan skema, dan "satu PR skema pada satu waktu" tetap berlaku. CI menambah pengecekan bahwa skema Drizzle cocok dengan database hasil migrasi, supaya keduanya tidak menyimpang.
- **Satu koneksi, dua klien.** Drizzle (`drizzle-orm/node-postgres`) memakai `pg` yang sudah dipakai `@prisma/adapter-pg`; satu `Pool` per proses. Mock waktu build (`src/lib/prisma.ts`) punya padanan Drizzle dengan perilaku yang sama: tanpa `DATABASE_URL` asli, query kosong.
- **Versi dipin persis**: `drizzle-orm` 0.45.4 (sudah memuat perbaikan GHSA-gpj5-g38j-94v9, SQL injection lewat identifier, diperbaiki di 0.45.2) dan `drizzle-kit` 0.31.11. Tidak memakai rilis `1.0.0-beta`. Naik versi hanya lewat PR sendiri setelah membaca changelog dan advisory.
- **Urutan pindah per domain, uang terakhir.** Modul baca-saja dan non-uang lebih dulu; buku besar, escrow, refund, payout, webhook pembayaran dan apa pun yang memakai row lock atau advisory lock paling akhir, masing-masing dengan review independen `sonnet` (AGENTS.md).
- **Semantik uang dipertahankan persis**: rupiah tetap `Int` (bukan float, bukan bigint baru), tingkat isolasi transaksi yang sama, `SELECT ... FOR UPDATE` dan `pg_advisory_xact_lock` yang sama di urutan yang sama, dan tiap `$transaction` menjadi `db.transaction` dengan batas yang sama. Raw SQL dipindah apa adanya ke `sql\`\`` Drizzle (terparameter), tidak ditulis ulang.
- **Perlindungan field kontak (ADR 0012)** pindah dari ekstensi Prisma ke lapisan repository yang menjadi satu-satunya jalan menulis `User`, `BankAccount`, `Donation` dan `PartnershipInquiry`; adapter Auth.js pindah ke `@auth/drizzle-adapter` atau adapter tulisan sendiri yang lewat lapisan itu.
- **Penutup**: setelah tidak ada lagi impor Prisma, migrasi dijalankan oleh runner SQL (atau `drizzle-kit migrate`) yang membaca riwayat `_prisma_migrations` yang ada, tanpa menjalankan ulang migrasi lama. Baru setelah itu `prisma`, `@prisma/*` dan `@auth/prisma-adapter` dihapus, beserta tahap `migrate` di Dockerfile diganti.

## Risiko yang diterima

- Cakupan besar: sekitar 511 file menyentuh Prisma, 75 model, 41 enum, 41 file non-tes memakai `$transaction`, 24 file raw SQL, 17 file row/advisory lock (hitungan di commit ini).
- Drizzle masih 0.x; API bisa berubah antar-minor. Dipin persis untuk itu.
- Selama transisi ada dua klien ORM di bundle; memori dan ukuran image naik sementara.
- Bug paritas (null vs undefined, `Date` vs string, urutan default) hanya tertangkap tes; tiap tiket menjalankan full suite termasuk tes DB-asli (`TEST_DATABASE_URL`).

## Konsekuensi

- Rencana dan tiket: `.scratch/drizzle-migration/`.
- Deploy tidak berubah sampai tiket penutup; tiket penutup memperbarui Dockerfile, `docker-compose.prod.yml` dan prompt deploy untuk agent server owner.
