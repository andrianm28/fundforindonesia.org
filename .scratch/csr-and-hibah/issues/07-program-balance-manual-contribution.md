# 07: Program Balance and Program-targeted Manual Contribution

**What to build:** CSR money that crosses the platform's own account is
recorded as a Manual Contribution against a Program, crediting a new
`PROGRAM_BALANCE` ledger account that can never be paid out — because a
Program is not a Campaign.

**Blocked by:** 01, and cross-feature `prd-compliance-fase-0-2 34`
(Manual Contribution does not exist yet as of this spec)

**Status:** done (sudah ada PROGRAM_BALANCE di ledger, manual-contributions.ts menerima programId)

- [ ] New `LedgerAccount` value `PROGRAM_BALANCE`
- [ ] Manual Contribution's target is generalised from "always a Campaign" to
      "a Campaign or a Program" — if ticket 34 has already landed with only a
      Campaign target, generalise it here rather than building a second,
      divergent Manual Contribution path; if ticket 34 lands already
      generalised, this ticket only adds the Program case's tests
- [ ] A Program-targeted Manual Contribution credits `PROGRAM_BALANCE`
      directly, with no Escrow Hold, no Platform Fee, no Provider Fee — same
      no-fee rule already decided for Campaign-targeted Manual Contributions
- [ ] Same two-person rule (proof required, second Admin approves) and same
      reversal-by-opposite-journal-not-deletion as the Campaign case
- [ ] A `PROGRAM_BALANCE` posting can never be the source of a Payout,
      however requested — the Payout request path requires a Campaign id and
      nothing here adds a Program-Payout path. This is an invariant to test
      (e.g. attempt a payout request against a Program id and confirm it is
      refused, plus confirm no code path reads `PROGRAM_BALANCE` as a Payout
      source), not merely a fact to state
- [ ] `postTransaction` property tests cover a Program-targeted Manual
      Contribution the same way they already cover a Campaign-targeted one:
      debits equal credits

## Comments

- 2026-09-27 (ticket-writing): this is the spec's flagged cross-spec
  dependency (spec.md, Further Notes). Do not start this ticket until
  `prd-compliance-fase-0-2 34` has landed, or coordinate directly with
  whoever is building it to land the Campaign-or-Program generalisation in
  one place.
