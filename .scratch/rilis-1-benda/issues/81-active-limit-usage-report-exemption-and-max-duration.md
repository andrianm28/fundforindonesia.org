# 81: M-e active-limit-usage-report-exemption-and-max-duration

**Status:** awaiting-merge

**Blocked by:** none; C12 dijawab owner 2026-10-04. Tidak boleh berjalan bersamaan dengan F4 (72); bagian lanjutan batasan itu terpotong dalam rencana.

**Ukuran:** S+S

**Catatan:** Aturan lifecycle; tanpa skema yang diketahui (batas Active memakai `AbuseThreshold` yang ada).

**Keputusan (2026-10-04, ronde C):** C12 batas tiga Active dicabut setelah Usage Report pertama; durasi maksimum 12 bulan, wakaf dikecualikan (sesuai rekomendasi).

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

- 2026-10-04 (ronde C): C12 dijawab owner sesuai rekomendasi: batas tiga Active dicabut setelah Usage Report pertama Fundraiser itu; durasi maksimum 12 bulan, wakaf dikecualikan. Acceptance di atas sudah memakai bentuk itu. `needs-info` menjadi `ready-for-agent`.

- 2026-10-30: dikerjakan di `claude/project-thread-iou1om-batas-aktif`. "Usage Report pertama" ditafsirkan: ada satu Usage Report milik Fundraiser (lewat Payout Campaign-nya) yang bukan sandbox dan belum ditandai dipertanyakan; Usage Report tidak punya tahap persetujuan, jadi "dikirim" adalah satu-satunya tahap. Durasi 12 bulan dihitung dari saat create/PATCH/submit/change request, tepat 12 bulan lolos; galat `CAMPAIGN_DURATION_EXCEEDED` (422). Layar admin scrutiny tidak lagi menyebut Fundraiser yang sudah bebas. `CONTEXT.md` (entri Batas Campaign Active, Usage Report, Campaign) menunggu koordinator.
