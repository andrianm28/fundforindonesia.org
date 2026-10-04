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
