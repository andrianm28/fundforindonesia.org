# 02: Campaign lifecycle: expand

**What to build:** The eight real Campaign Statuses exist in the schema alongside the old free-text string, backfilled from it, so that later tickets can migrate readers one group at a time without anything breaking.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] An enum covering Draft, Submitted, Rejected, Active, Suspended, Cancelled, Completed and Expired lands beside the existing string column
- [ ] A migration backfills every existing row, mapping the current `active`/`completed`/`expired` values and the interim `pending` written by the current stopgap
- [ ] Every write that sets the old string also sets the enum, so the two cannot diverge
- [ ] No reader changes in this ticket; the full suite stays green

## Comments

- 2026-09-26 (status tidy): Done through .scratch/campaign-status-transitions (C20) and .scratch/legacy-status-contract 01-02: every reader and writer uses the lifecycleStatus enum.
