# 61: Pengingat terjadwal tidak boleh menyasar Demo Campaign

**Type:** bug (pencegahan sebelum cron dipasang)

**Status:** awaiting-merge

**Blocked by:** none

Disetujui owner pada 2026-10-04.

## Konteks

Cron `POST /api/internal/jobs/run` (prd-compliance 45, `src/lib/scheduled-jobs.ts`)
belum dipasang di produksi. Produksi punya 8 Demo Campaign (`isDemo`); begitu
cron dipasang, pengingat tenggat akan terkirim ke Fundraiser fiktif Campaign
itu. Pembanding yang sudah benar: `src/lib/money/dormant-balances.ts`
(`isDemo: false`).

## Acceptance criteria

- [x] Job terjadwal yang mengirim pesan ke manusia dan terikat Campaign (hanya `sendCampaignDeadlineReminders`) mengecualikan Demo Campaign via `NOT_A_DEMO_CAMPAIGN`; lihat Comments
- [x] `sendCampaignDeadlineReminders` tidak mengirim Notification maupun email, dan tidak menandai `deadlineReminderSentAt`, untuk Demo Campaign.
- [x] Job uang yang tidak mengirim pesan (sweep escrow) tidak berubah perilaku.
- [x] Tes per job; tanpa migrasi.

## Comments
- 2026-10-04, branch `claude/rilis-1-61-reminders-skip-demo`, sha kode 8dec795: `sendCampaignDeadlineReminders` kini memakai `...NOT_A_DEMO_CAMPAIGN` di `where`, tanpa mempedulikan `SHOW_DEMO_CAMPAIGNS`. Tidak diubah, sengaja: sweep escrow (tanpa pesan); `sweepStuckLateSettlementRefunds` (Volunteer Trip tidak punya `isDemo`, ADR 0014); `sendKindAuthorisationExpiryWarnings` (terikat Partner Organisation, bukan Campaign; butuh keputusan owner bila Partner Organisation demo ada). `dormant-balances`, `partnership-inquiries`, `collecting-entity` bukan job terjadwal.
