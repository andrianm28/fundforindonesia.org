# 07: Program Balance and Program-targeted Manual Contribution

**What to build:** CSR money that crosses the platform's own account is
recorded as a Manual Contribution against a Program, crediting a new
`PROGRAM_BALANCE` ledger account that can never be paid out — because a
Program is not a Campaign.

**Blocked by:** 01, and cross-feature `prd-compliance-fase-0-2 34`
(Manual Contribution does not exist yet as of this spec)

**Status:** done (PR #182, 05d7292)

- [x] New `LedgerAccount` value `PROGRAM_BALANCE`
- [x] Manual Contribution's target is generalised from "always a Campaign" to
      "a Campaign or a Program" — if ticket 34 has already landed with only a
      Campaign target, generalise it here rather than building a second,
      divergent Manual Contribution path; if ticket 34 lands already
      generalised, this ticket only adds the Program case's tests
- [x] A Program-targeted Manual Contribution credits `PROGRAM_BALANCE`
      directly, with no Escrow Hold, no Platform Fee, no Provider Fee — same
      no-fee rule already decided for Campaign-targeted Manual Contributions
- [ ] Same two-person rule (proof required, second Admin approves) and same
      reversal-by-opposite-journal-not-deletion as the Campaign case
- [x] A `PROGRAM_BALANCE` posting can never be the source of a Payout,
      however requested — the Payout request path requires a Campaign id and
      nothing here adds a Program-Payout path. This is an invariant to test
      (e.g. attempt a payout request against a Program id and confirm it is
      refused, plus confirm no code path reads `PROGRAM_BALANCE` as a Payout
      source), not merely a fact to state
- [x] `postTransaction` property tests cover a Program-targeted Manual
      Contribution the same way they already cover a Campaign-targeted one:
      debits equal credits

## Comments

- 2026-09-27 (ticket-writing): this is the spec's flagged cross-spec
  dependency (spec.md, Further Notes). Do not start this ticket until
  `prd-compliance-fase-0-2 34` has landed, or coordinate directly with
  whoever is building it to land the Campaign-or-Program generalisation in
  one place.

- 2026-10-02: awaiting-merge. PR #182, commit 89205f1. Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.

- 2026-10-02: butir yang dicentang terbukti oleh tes: enum `PROGRAM_BALANCE`
  (prisma/schema.prisma; ledger.test.ts), target Campaign-atau-Program
  (manual-contributions.test.ts), kredit langsung tanpa Escrow Hold/fee
  (ledger.test.ts, `manualContributionReceivedLegs`), Payout tidak pernah
  bersumber dari Program (payouts.test.ts: `requestPayout` dan `approvePayout`
  menolak dengan `InvalidPayoutSubjectError` sebelum ada kunci atau pembacaan
  saldo), dan properti debit = kredit serta saldo ledger = model
  (ledger.test.ts). Butir "two-person rule dan reversal" sengaja belum
  dicentang: reversal Program terbukti (DEBIT `PROGRAM_BALANCE`), tetapi bukti
  wajib dan self-approval baru diuji pada jalur Campaign, belum pada target
  Program; dan reversal tidak punya guard saldo untuk Program (mungkin
  over-reversal), menunggu keputusan owner.
- 2026-10-02: done. Merge ke main sebagai 05d7292.
