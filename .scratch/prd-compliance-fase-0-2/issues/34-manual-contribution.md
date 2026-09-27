# 34: Manual Contribution with two-person rule and reversal

**What to build:** Money that arrives outside the payment gateway gets into the books properly, with evidence, and can be corrected without anything being erased.

**Blocked by:** None (ticket 8 was its blocker; see Comments)

**Status:** ready-for-agent

- [ ] Admin-only, proof of transfer required, approved by a second Admin
- [ ] Credited directly to Campaign Balance, or Program Balance when it names a Program, with no Escrow Hold and neither fee
- [ ] Posted to its own ledger account and marked distinctly in collected totals
- [ ] Reversible by opposite journal while no Payout has used it, and never deleted

## Comments

- 2026-09-27 (blocker unblocked, owner decision): this ticket listed ticket 8 as
  a blocker, but 08 is `wontfix` because it was superseded, not rejected; its
  work lives in `.scratch/retire-role-hierarchy/`. The edge was stale, so it is
  removed. Recording a Manual Contribution keys on assignments, not rank, which
  is what ADR 0005 requires.
