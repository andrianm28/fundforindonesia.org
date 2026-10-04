# 03: H-4 upload-hardening-and-serving

**Status:** ready-for-agent

**Blocked by:** none

**Ukuran:** M

**Catatan:** Keamanan unggahan; tanpa skema. Rate limit upload ditangani H-1 (builder lain).

## Latar

`/uploads` harus terbukti tersaji di build standalone dan unggahan harus tervalidasi isinya, bukan hanya `Content-Type` yang dikirim klien.

## Berkas relevan

- `src/app/api/upload/route.ts`
- `src/lib/cover-image.ts`
- `next.config.*`
- `docker-compose.prod.yml` (volume uploads; baca saja)

## Acceptance

- [ ] Uji yang membuktikan berkas hasil unggah tersaji lewat `/uploads/...` pada build standalone, lewat route atau alias bila perlu
- [ ] Validasi magic byte atau re-encode gambar; berkas yang tipenya tidak cocok ditolak
- [ ] Nama berkas dibangkitkan server; tidak ada path traversal
- [ ] Tes route untuk berkas valid, tipe palsu, dan terlalu besar

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
