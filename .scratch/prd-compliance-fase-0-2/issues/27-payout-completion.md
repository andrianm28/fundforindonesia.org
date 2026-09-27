# 27: Payout completion with proof under the two-person rule

**What to build:** Money finally leaves the platform through the system. A second Admin, different from the approver, records the transfer with evidence, and the clearing account drains.

**Blocked by:** 5

**Status:** ready-for-agent

- [ ] A payout is marked Completed only with proof of transfer attached
- [ ] The completing Admin must differ from the approving Admin, enforced not merely advised
- [ ] Completion posts legs that debit payout clearing and credit the provider balance, closing the gap where that account is debited on every settlement and never credited
- [ ] Approval still never contacts a payment provider, per ADR 0006
- [ ] Reconciliation stops listing a completed payout as outstanding work

## Comments

- 2026-09-25 (from C20 ticket 07): Cancellation approval checks "no Payout COMPLETED" while holding the Campaign row lock (`SELECT ... FOR UPDATE`). The endpoint that marks a Payout COMPLETED must take the same Campaign row lock before its status write. Otherwise a Payout can complete between that check and the Cancellation, breaking the rule that Cancellation happens only while no Payout has completed.
- 2026-09-25 (architecture review): The Payout "mark Completed" step must also refuse an Admin who is the Campaign's Fundraiser (CONTEXT.md, Admin). "Completer ≠ approver" alone does not stop the owner, who is the requester.
- 2026-09-25 (subject guard spec): marking a Payout Completed must also call `requirePayoutAllowed` from the subject guard. A Suspension (or Cancellation) that lands after approval still holds the Payout (CONTEXT.md, Payout). See `.scratch/subject-guard-and-suspension-money/spec.md`.
- 2026-09-27 (blocker unblocked, owner decision): this ticket listed ticket 8 as a
  blocker, but 08 is `wontfix` because it was superseded, not rejected; its work
  lives in `.scratch/retire-role-hierarchy/`. The edge was stale, so it is
  removed. Payout does not actually depend on it: the two-person rule in FFI-07
  runs on assignments (VERIFIER, ADMIN, FUNDRAISER), which is what ADR 0005
  requires, and never on rank ordering — so "no code infers a permission from
  rank" is not a precondition for building it.
