# 62: S-0 contract-release

**Status:** ready-for-agent

**Blocked by:** konfirmasi `legacy-status-contract` 02 dan `retire-role-hierarchy` 02 sudah live di produksi; tidak lebih awal dari ~2026-10-10 (rencana: setelah hitungan A1). Hitungan A1 sudah aman: tidak ada pemegang `role` lama tanpa assignment.

**Ukuran:** S+S

**Catatan:** Migrasi ikut aturan serialisasi: satu PR skema pada satu waktu. Harus selesai sebelum data nyata masuk (sebelum M1).

## Latar

Tiket ini menjalankan dua tiket yang sudah ada dan berstatus `ready-for-human`: `.scratch/legacy-status-contract/issues/03-drop-status-column.md` dan `.scratch/retire-role-hierarchy/issues/03-drop-role-columns.md`. Keduanya dibuang sebelum ada data donasi nyata supaya migrasi destruktifnya tidak menyentuh data produksi yang berharga. Satu PR per migrasi, berurutan.

## Berkas relevan

- `prisma/schema.prisma` (`Campaign.status` di sekitar baris 446; `User.role` baris 67; enum `Role`)
- `prisma/migrations/`
- `src/__tests__/campaign-status-readers.test.ts`, `tests/support/campaign-status-column-references.ts`, `tests/support/campaign-status-canary.ts` (dihapus, lihat Comments tiket 03 legacy-status-contract)
- `src/lib/drop-migration-guard.test.ts`

## Acceptance

- [ ] Migrasi menghapus `Campaign.status` beserta indeksnya; skema tidak lagi mendeklarasikannya; tiga `omit: { status: true }` (route list, `POST /api/campaigns`, `PATCH /api/campaigns/[slug]`) dan guard/canary-nya dihapus
- [ ] Migrasi menghapus `User.role`, `User.isVerified`, `User.verificationType`, dan enum `Role`; tidak ada kode yang masih memakainya
- [ ] Setiap migrasi diterapkan ke Postgres pada keadaan sebelumnya dan `prisma migrate diff` kosong sesudahnya
- [ ] `src/lib/drop-migration-guard.test.ts` hijau (migrasi destruktif lolos guard) dan full suite di CI hijau
- [ ] Status kedua tiket sumber di `legacy-status-contract` dan `retire-role-hierarchy` diubah ke `done` di PR yang sama

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
