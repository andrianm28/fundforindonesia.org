# 81: M-e active-limit-usage-report-exemption-and-max-duration

**Status:** needs-info

**Blocked by:** none; menunggu C12. Tidak boleh berjalan bersamaan dengan F4 (72); bagian lanjutan batasan itu terpotong dalam rencana.

**Ukuran:** S+S

**Catatan:** Aturan lifecycle; tanpa skema yang diketahui (batas Active memakai `AbuseThreshold` yang ada).

**Menunggu keputusan:** C12 (rekomendasi: batas tiga Active dicabut setelah Usage Report pertama; durasi maks 12 bulan, wakaf dikecualikan).

## Latar

Dua aturan lifecycle: batas tiga Campaign Active dicabut setelah Usage Report pertama Fundraiser, dan durasi Campaign maksimal 12 bulan (wakaf dikecualikan).

## Berkas relevan

- `src/lib/abuse-thresholds.ts` (`activeCampaignsPerFundraiser`)
- `src/lib/campaign-lifecycle.ts` (`submitCampaign` ~523)
- `src/lib/campaign-lifecycle.active-campaign-limit.test.ts`
- `src/app/api/campaigns/route.ts`

## Acceptance

- [ ] Fundraiser dengan Usage Report pertama tidak lagi dibatasi tiga Campaign Active; yang belum tetap dibatasi
- [ ] Campaign dengan tenggat lebih dari 12 bulan ditolak dengan galat domain; Kind wakaf dikecualikan
- [ ] Tes unit untuk kedua aturan dan tes batas (tepat 12 bulan)
- [ ] `CONTEXT.md` diperbarui oleh koordinator, bukan builder

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
