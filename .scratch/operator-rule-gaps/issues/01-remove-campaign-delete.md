# 01: Campaigns can no longer be deleted

**What to build:** The Campaign DELETE endpoint and the Admin panel's delete button disappear, and so does the helper that only DELETE used. A Campaign now stops only through Cancellation, Suspension, Expired or Completed (ADR 0016). See `.scratch/operator-rule-gaps/spec.md`.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] The Campaign `[slug]` route exports no DELETE handler, and a test asserts that
- [ ] `DeleteCampaignButton` and its use on the Admin Campaigns page are removed, and a page test asserts no delete control is rendered
- [ ] `isLifecycleRecordRestrict` and its tests are removed, along with any guard entries that referenced them
- [ ] Full suite green, tsc adds no errors
