# 06: Verifier and Admin assignments: expand

**What to build:** Verifier and Admin become assignments a person holds, sitting beside the existing rank so nothing breaks yet. One person may hold both.

**Blocked by:** None (can start immediately)

**Status:** wontfix

- [ ] Assignments are modelled such that holding both is natural, not a special case
- [ ] Existing users are backfilled: current ADMIN gains both assignments, MODERATOR gains Verifier
- [ ] The `Role` hierarchy still works and still governs access in this ticket
- [ ] ADR 0005 is referenced in the model's documentation

## Comments

- 2026-09-26: Superseded. The assignments (06) and the guard migration (07) landed through `.scratch/capacity-judgement/` and `campaign-rule-bugs/04`. The contract step (08) is `.scratch/retire-role-hierarchy/`.
