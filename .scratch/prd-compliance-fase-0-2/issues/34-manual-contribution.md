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
- 2026-09-27 (review findings, fixed in PR #75): three of the independent
  review's points are addressed here.
  1. The reversal had no two-person separation: `reversedById` could be
     `recordedById` or `decidedById`, so the Admin who had just approved a
     contribution could pull the money back out alone -- record, approve,
     reverse, and the books are back where they started with three decisions on
     the record and nobody outside the pair to notice. `reverseManualContribution`
     now refuses both halves of the pair with the same `SelfApprovalError` an
     approval of the wrong person gets, before the status is read and before
     any write. The code is still `SELF_APPROVAL` for both halves; the error
     takes an `action` so the sentence names the act instead of telling an
     Admin they may not approve something they never approved.
  2. A Demo Campaign was not refused, so real rupiah could be credited into one
     and locked there for good: `payouts.ts` and `refunds.ts` both refuse it,
     so neither could ever move that money out. The refusal is now
     `requireNotDemoCampaign` in this module, throwing the same
     `DemoCampaignError` the other two paths throw, and it is called from both
     commands -- recording as well as approval, because recording is where this
     path is opened (a Payout and a Refund are both refused at the request, not
     at the approval) and because a contribution to a Campaign whose data is
     fictional is not a queue entry worth keeping. One function, so the rule
     cannot drift away from the two paths that already refuse it.
  3. The migration comment claimed every relation was `onDelete: Restrict` when
     `LedgerEntry.manualContributionId` is `SetNull`; both the migration and the
     schema comment now say so and say why (a ledger entry is the immutable
     record of the money and outlives the row it points at).
- 2026-09-27 (noted, not done, deliberately): (1) CONTEXT.md says a Manual
  Contribution is never deleted, and no database constraint enforces that --
  `onDelete: Restrict` stops a Campaign, a Program or a person being deleted out
  from under the row, but nothing stops the row itself being deleted, by this
  code or by a script against the database. Closing that gap means a
  database-level rule (a trigger, or a revoking of DELETE on the table) whose
  cost and blast radius are a decision for the owner, not something to add
  quietly inside a feature PR. What this PR does instead is assert the
  guarantee it does have: `manual-contributions.test.ts` now scans all of `src`
  (not just this module) for a `delete`/`deleteMany` of this row, and the
  decision route enumerates its verbs so "delete" has nowhere to land. (2) The
  amount is now bounded by int4's ceiling (2 147 483 647) in the service layer,
  because a larger rupiah is refused by the column as a driver error that no
  route can turn into a 400; the bound is the column's own, not a rule of ours,
  and the largest amount the column holds still records.
