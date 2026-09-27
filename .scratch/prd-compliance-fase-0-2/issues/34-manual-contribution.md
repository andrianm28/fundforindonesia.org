# 34: Manual Contribution with two-person rule and reversal

**What to build:** Money that arrives outside the payment gateway gets into the books properly, with evidence, and can be corrected without anything being erased.

**Blocked by:** None (ticket 8 was its blocker; see Comments)

**Status:** done (PR #75, 30af106)

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
- 2026-09-27 (implemented, PR #75): the Campaign-or-Program generalisation
  landed here, generalised, as `csr-and-hibah 07` asked it might.
  `ManualContributionSubject` takes a Campaign or a Program, `PROGRAM_BALANCE`
  is the ledger account a Program is credited to, and the two-person rule and
  the reversal are one implementation rather than two. So `csr-and-hibah 07`
  keeps only its invariant to test: `manual-contribution-isolation.test.ts`
  already asserts that a `PROGRAM_BALANCE` posting can never be the source of a
  Payout (attempted through the schema, the Payout/Refund/escrow services, the
  Payout routes, and the two subject types), so that ticket's remaining box is
  answered by a test that already exists. The
  `postTransaction` property test for a Program-targeted contribution is in
  `ledger.test.ts` here for the same reason.
- 2026-09-27 (two judgement calls, flagged for the reviewer): (1) a `REJECTED`
  status was added, which no box asked for -- without it a mistyped record that
  a second Admin will not approve has no way to be closed, and a queue entry
  that cannot be closed is a queue that fills with noise. (2)
  `Campaign.collectedAmount` is incremented on approval and decremented on the
  reversal, in the same transaction as the ledger, the way the settlement
  webhook does it. That is what makes "masuk angka terkumpul dengan penanda
  tersendiri" true of the campaign page as well as of the Impact breakdown, but
  it adds this module to two writer allowlists and makes the reconciliation
  report account for off-gateway credits. Both are argued in the PR body.
