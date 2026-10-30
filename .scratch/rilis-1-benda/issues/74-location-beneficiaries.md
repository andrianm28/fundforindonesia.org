# 74: F6 location-beneficiaries

**Status:** awaiting-merge

**Blocked by:** none; C8 dijawab owner 2026-10-04

**Ukuran:** M, skema

**Catatan:** Skema: menyentuh `prisma/schema.prisma`/migrasi; ikuti aturan satu PR skema pada satu waktu, timestamp migrasi dibagi koordinator.

**Keputusan (2026-10-04, ronde C):** C8 provinsi dari daftar statis, kabupaten/kota teks bebas, penerima manfaat dan jumlah opsional (sesuai rekomendasi).

## Latar

Campaign punya `location` teks bebas dan tidak punya penerima manfaat. PRD meminta lokasi dan penerima manfaat yang bisa dilaporkan.

## Berkas relevan

- `prisma/schema.prisma` (`Campaign.location` ~477)
- `src/app/campaign/create`
- `src/app/api/campaigns/route.ts` dan `[slug]/route.ts`
- `src/components/campaign/CampaignDetailView.tsx`
- `src/lib/money/impact.ts` (hubungan dengan penerima manfaat laporan)

## Acceptance

- [ ] Migrasi menambah provinsi dan kolom penerima manfaat sesuai keputusan C8; data lama tidak hilang
- [ ] Form Campaign memilih provinsi dari daftar statis, kabupaten/kota teks bebas, penerima manfaat dan jumlah opsional
- [ ] Halaman publik menampilkan lokasi dan penerima manfaat
- [ ] Validasi di server; tes route dan komponen

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C): C8 dijawab owner sesuai rekomendasi: provinsi dari daftar statis, kabupaten/kota teks, penerima manfaat dan jumlahnya opsional. Acceptance di atas sudah memakai bentuk itu. `needs-info` menjadi `ready-for-agent`.

- 2026-10-30: dikerjakan di branch `claude/project-thread-iou1om-lokasi`. Migrasi `20261031000000_campaign_location_beneficiaries` hanya ADD COLUMN nullable (`province` kode Kemendagri 2 digit, `regency`, `beneficiaryDescription`, `beneficiaryCount` + CHECK > 0); `location` lama tidak disentuh. Daftar 38 provinsi di `src/lib/indonesia-provinces.ts`; skema zod bersama di `src/lib/campaign-location.ts` dipakai POST /api/campaigns dan PATCH /api/campaigns/[slug] (tidak dibekukan saat Active, hanya title dan description yang beku); GET menampilkan kelima field. Form (wizard langkah 1, CampaignEditForm) lewat `CampaignLocationFields`; CampaignDetailView menampilkan lokasi (fallback `location`) dan penerima manfaat. `beneficiaryName` (pemicu petunjuk duplikat) sengaja dibiarkan terpisah dari `beneficiaryDescription`.
