# 78: A-5 admin-program-crud

**Status:** ready-for-agent

**Blocked by:** none (`createProgram`, `updateProgram` sudah ada di `src/lib/programs.ts`)

**Ukuran:** M

**Catatan:** Layar Admin; tanpa skema. Program tidak membawa uang (`program-money-isolation.test.ts` harus tetap hijau).

## Latar

Program hanya bisa dibuat lewat seed atau API; Admin tidak punya layar CRUD.

## Berkas relevan

- `src/lib/programs.ts`
- `src/app/program/page.tsx` dan `[slug]/page.tsx` (publik)
- `src/lib/program-money-isolation.test.ts`
- `src/components/admin/AdminSidebar.tsx` (satu baris)
- route dan halaman baru di `src/app/admin/programs/`

## Acceptance

- [ ] Admin membuat, mengubah, dan melihat daftar Program dari layar
- [ ] Validasi sektor dan input memakai `parseSector` dan galat `InvalidProgramInputError`
- [ ] Tidak ada penulisan jurnal atau relasi uang; tes isolasi tetap hijau
- [ ] Hanya ADMIN; tes route, halaman, dan e2e

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
