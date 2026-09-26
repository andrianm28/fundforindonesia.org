# 07: Verifier and Admin: migrate guards

**What to build:** Every protected route and panel checks what a person is assigned to do rather than how senior they rank, so an Admin is no longer a Verifier by accident.

**Blocked by:** 6

**Status:** wontfix

- [ ] All role-guarded routes and pages check assignment, not rank
- [ ] The audit trail records which capacity someone acted in
- [ ] An Admin without the Verifier assignment can no longer approve a Verification Request
- [ ] CI green: the hierarchy still exists but no longer decides access

## Comments

- 2026-09-26: Superseded. The assignments (06) and the guard migration (07) landed through `.scratch/capacity-judgement/` and `campaign-rule-bugs/04`. The contract step (08) is `.scratch/retire-role-hierarchy/`.
