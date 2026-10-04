# 11: Legacy Suspensions can be lifted

**What to build:** Campaigns suspended before the status-change log existed (by the old Verifier-only moderation action) have no SUSPENDED log row. `liftSuspension` therefore refuses them with 409 (UnrecordedSuspensionError) and a message to contact the technical team. Each such Campaign should become liftable under the normal two-Admin rule.

**Blocked by:** None (can start immediately)

**Status:** wontfix

Why human: this needs production data that no agent can reach, and a data decision.
1. Count the Campaigns with `lifecycleStatus = SUSPENDED` and no `CampaignStatusChange` row with action SUSPENDED. If the count is zero, close this ticket as `wontfix`.
2. For each one, decide what status it had before its Suspension. The old action also reached SUBMITTED Campaigns, so ACTIVE cannot be assumed: restoring a never-moderated Campaign to Active would publish it unreviewed. The evidence to check is whether any Donation was settled for it; if none was, look for a moderation approval notification.
3. Then write a one-off, environment-specific data migration. It inserts one SUSPENDED row per Campaign with the decided `fromStatus`, capacity SYSTEM, a null actor (so any Admin may lift it) and a reason naming the backfill.

- [ ] The count is recorded in this ticket's Comments
- [ ] The prior status is decided and recorded per Campaign
- [ ] The backfill migration exists, is marked not to be reused on other environments (as the M9 isDemo migration is), and after it runs, a lift on each such Campaign succeeds for a second Admin

## Comments

- 2026-10-04 (percepatan-full-rilis, Track D): hitungan baca-saja di produksi, Campaign `SUSPENDED` tanpa baris `CampaignStatusChange` bertindakan SUSPENDED = **0**. Sesuai langkah 1 tiket ini, ditutup `wontfix`: tidak ada Suspension lama yang perlu backfill, jadi tidak ada migrasi data yang ditulis. Bila kelak ada pengecualian, `liftSuspension` tetap menolaknya dengan 409 `UnrecordedSuspensionError`.
