# 06: Kategori Campaign dibaca dari tabel Category, dikelola Admin

**Type:** task

**Status:** done

**Source:** audit REQ-01 (T6)

## What

Form buat Campaign memakai daftar kategori yang ditulis tangan
(`kesehatan`, `anak`, `lingkungan`, `lainnya`, ...) yang tidak cocok dengan
tabel `Category` (seed: `bantuan-medis`, `rumah-ibadah`, `panti-asuhan`, ...).
Campaign bisa berakhir di kategori yang halamannya 404, dan Admin tidak punya
layar kategori (PRD: "Category Campaign dikelola Admin dari panel").

## Done

- Form `/campaign/create` membaca `/api/categories`; daftar tulisan tangan
  dihapus. Saran kategori di `/search` juga dari tabel yang sama.
- `POST /api/campaigns` menolak slug yang tidak ada di `Category` dengan 400
  (pesan Indonesia, `fieldErrors.category`). `Campaign.category` adalah string
  slug tanpa FK, jadi validasi dilakukan di route. `PATCH /api/campaigns/[slug]`
  tidak menerima `category` (zod membuangnya), jadi tidak ada jalur update lain.
- Layar Admin `/admin/kategori` (menu "Kategori"): daftar, tambah, ubah nama,
  hapus. API `/api/admin/categories` dan `/api/admin/categories/[id]` lewat
  `withHiddenAssignmentCheck(Assignment.ADMIN, ...)` (404 untuk non-Admin).
- Slug: huruf kecil a-z, 0-9, tanda hubung; unik (409); **tidak bisa diubah**
  setelah dibuat karena Campaign, override fee dan Escrow Hold merujuk slug.
  Ubah nama hanya mengganti label.
- **Hapus** didukung: 409 selama ada Campaign yang memakai slug-nya; kategori
  yang tidak terpakai boleh dihapus.
- Hanya kolom yang ada (`name`, `slug`, `icon`, `order`); tanpa perubahan skema
  dan tanpa migrasi.

## Not done / owner

- Empat kategori wakaf (masjid, sekolah, fasilitas kesehatan, fasilitas umum;
  dibatasi Kind WAKAF) **belum** ada: itu butuh kolom pembatas Kind, yaitu
  perubahan skema. Admin sudah bisa menambah kategori biasa dari layar ini.
- Seed berbeda dari isi produksi? Cek produksi dulu (read-only):
  `SELECT category, COUNT(*) FROM "Campaign" WHERE category NOT IN (SELECT slug FROM "Category") GROUP BY category;`
  Baris yang muncul = Campaign dengan kategori yatim; tambahkan kategorinya di
  `/admin/kategori` dengan slug yang sama, atau pindahkan Campaign-nya.

## Tests

`src/lib/categories.test.ts`, `src/app/api/admin/categories/route.test.ts`,
`src/app/api/admin/categories/[id]/route.test.ts`,
`src/app/api/campaigns/route.test.ts` (kategori tak dikenal -> 400),
`src/app/campaign/create/page.test.tsx` (opsi dari data),
`src/__tests__/properties/roles-expand-guard.test.ts`.
