# 05: Campaign lifecycle: contract

**What to build:** The free-text status string is gone. There is exactly one representation of where a Campaign sits in its life, and an invalid status is now unrepresentable.

**Blocked by:** 3, 4

**Status:** done

- [ ] The string column is dropped by migration and no code references it
- [ ] Dual-write scaffolding from ticket 2 is removed
- [ ] A Campaign cannot be created in any status other than Draft
- [ ] Full suite green; no new type errors

## Comments

- 2026-09-26 (status tidy): Done through .scratch/legacy-status-contract 01-02. The column drop is .scratch/legacy-status-contract/issues/03 (ready-for-human, after deploy).
