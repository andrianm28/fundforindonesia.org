# 74: F6 location-beneficiaries

**Status:** needs-info

**Blocked by:** none; menunggu C8

**Ukuran:** M, skema

**Catatan:** Skema: menyentuh `prisma/schema.prisma`/migrasi; ikuti aturan satu PR skema pada satu waktu, timestamp migrasi dibagi koordinator.

**Menunggu keputusan:** C8 (rekomendasi: provinsi dari daftar statis, kabupaten/kota teks bebas, penerima manfaat + jumlah opsional).

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
