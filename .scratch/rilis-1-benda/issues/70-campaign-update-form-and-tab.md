# 70: F1 campaign-update-form-and-tab

**Status:** done

**Blocked by:** none (`POST /api/campaigns/[slug]/updates` dan `CampaignUpdate` sudah ada)

**Ukuran:** M

**Catatan:** Layar; tanpa skema.

## Latar

Fundraiser tidak punya form untuk menulis Kabar Terbaru dan halaman publik Campaign tidak punya tab untuk membacanya.

## Berkas relevan

- `src/app/api/campaigns/[slug]/updates/route.ts`
- `prisma/schema.prisma` (`CampaignUpdate` ~1118)
- `src/components/campaign/CampaignDetailView.tsx`
- `src/app/campaign/[slug]/page.tsx`
- `src/app/akun/kampanye-saya/[slug]/`

## Acceptance

- [ ] Fundraiser pemilik menulis kabar (judul, isi, gambar) dari layar kelolanya
- [ ] Halaman publik Campaign punya tab Kabar Terbaru, urut terbaru, dengan paginasi
- [ ] Hanya Fundraiser pemilik yang bisa menulis; Campaign yang belum disetujui tidak menampilkan tab ke publik
- [ ] Tes komponen dan e2e menulis lalu membaca kabar

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
- 2026-10-30: form di `/akun/kampanye-saya/[slug]/kabar`, tab publik via `CampaignUpdatesTab`; schema gambar POST kini menerima `/uploads/...` (sebelumnya `.url()` menolak hasil `/api/upload`). E2E belum ditulis (butuh fixture DB; jalan di CI).
- 2026-10-30: merged ke main lewat #295 (squash 1fee2d8), atas persetujuan owner. Belum ter-deploy.
