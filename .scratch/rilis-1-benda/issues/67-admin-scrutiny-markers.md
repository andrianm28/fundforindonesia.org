# 67: A-3 admin-scrutiny-markers

**Status:** ready-for-agent

**Blocked by:** none (`CampaignAuditMarker` dan `DonationReviewMarker` sudah ada)

**Ukuran:** S

**Catatan:** Layar baca-saja; tanpa skema.

## Latar

Penanda audit hasil `evaluateSettledDonationScrutiny` ditulis tetapi tidak ada daftar yang bisa dibaca Admin; `/api/admin/scrutiny` belum punya layar.

## Berkas relevan

- `src/lib/scrutiny.ts`
- `src/app/api/admin/scrutiny/route.ts`
- `prisma/schema.prisma` (`CampaignAuditMarker` ~1648, `DonationReviewMarker` ~1668)
- `src/components/admin/AdminSidebar.tsx` (satu baris)
- halaman baru `src/app/admin/scrutiny/page.tsx`

## Acceptance

- [ ] Halaman Admin mendaftar penanda Campaign dan Donasi, terbaru lebih dulu, dengan alasan dan tautan ke subjek
- [ ] Tanpa data pribadi donor di daftar (nama anonim tetap tersamar)
- [ ] Hanya ADMIN yang bisa membuka; yang lain 404
- [ ] Tes halaman dan tautan sidebar

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
