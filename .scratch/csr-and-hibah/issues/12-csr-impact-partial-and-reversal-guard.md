# 12: CSR block hides alone on /impact, and a reversal never leaves a Program balance negative

**What to build:** Two owner decisions of 2026-10-02, follow-ups to tickets 08
(#174) and 07 (#182).

**Blocked by:** none (07 and 08 are `done`)

**Status:** done (PR #188, 9a131c6)

## Decisions

1. **`/impact` hides the CSR block only.** When the Program books do not
   reconcile (`CsrDoesNotReconcileError`), the six Campaign lines stay on
   `/impact`, and the CSR block is replaced by a message, like the Program
   page. `GET /api/impact` answers 200 with the breakdown and `csr: null` as the
   "CSR unavailable" marker (the smallest change to the existing contract).
   `ImpactDoesNotReconcileError` for the six lines still refuses everything,
   as before. The test that locked the old behaviour is replaced.
2. **Reversal of a Manual Contribution must not make a Program Balance
   negative.** Refused with a domain error carrying an Indonesian message,
   mapped to 409 by `domain-errors`, judged inside the transaction under the
   Program row lock that the ledger posting uses.

## Acceptance criteria

- [x] `GET /api/impact` with an unreconciled or negative Program Balance
      answers 200, six lines and `collected` intact, `csr` is `null`, and no
      CSR figure appears in the body; the booked/explained delta goes to the
      log only
- [x] `/impact` shows the six lines and an `impact-csr-unavailable` message in
      place of the CSR block in that case
- [x] An unreconciled six-line breakdown still answers 500 / hides everything
- [x] Reversing a Program contribution equal to the Program balance succeeds
- [x] Reversing more than the Program balance is refused, nothing posted, the
      contribution stays APPROVED
- [x] The balance is read under the Program `FOR UPDATE` lock; a reversal that
      loses the status claim posts nothing
- [x] `CONTEXT.md` (Program Balance) records both rules

## Comments

- 2026-10-02 (finding on decision 2): the guard already existed. Ticket 07's
  `reverseManualContribution` compares the subject's balance with the amount
  under the row lock (`balance < amount` throws
  `ManualContributionAlreadySpentError`, code
  `MANUAL_CONTRIBUTION_ALREADY_SPENT`, Indonesian message, 409), and it covers
  Programs as well as Campaigns. A second error type would have duplicated it,
  so none was added; what was missing was Program-specific tests, which this
  ticket adds (equal balance, over-balance, lock, lost claim). There is no
  integration-test infrastructure, so the race is covered at the unit level.
- 2026-10-02: awaiting-merge. PR #188.
- 2026-10-02: merge ke main sebagai 9a131c6 (#188).
