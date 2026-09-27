# 28b: Ledger transaction id is not unique, so posting is read-then-write

**What to build:** `postTransaction`'s idempotency check reads for an
existing `transactionId` and then writes. That is a read-then-write, not a
constraint, so two callers racing the same transaction can both see "absent"
and both insert. Today it is safe only because the Payout row itself is
claimed first by an `updateMany`, so the losers fail there. That safety is
incidental to the caller, not a property of the ledger.

**Blocked by:** None (can start immediately)

**Status:** done (PR #82)

- [x] Re-posting a `transactionId` that already exists is refused by the
      database, not merely by a preceding read
- [x] The refusal is a clear duplicate rather than a unique-violation
      stack trace, and the caller can distinguish it from a genuine failure
- [x] A concurrent double-post of the same id leaves exactly one row
- [x] Existing callers that already guard with `updateMany` keep working
      unchanged, and the redundant guard is either kept and commented or
      removed with its reason

## Comments

- 2026-09-27 (raised by the independent review of PR #73): `transactionId`
  is indexed but not unique (`prisma/schema.prisma`), so the guarantee
  currently rests on each caller happening to claim its own row first. That
  is a real gap, not a style point, and it is invisible until a second
  caller appears that does not. Filed rather than fixed inside #73 because
  adding a unique constraint is a schema migration with a data-cleanup
  question attached, which does not belong in a Payout completion PR.

- 2026-09-27 (agent, PR #82). `LedgerEntry.legIndex` numbers a
  transaction's legs, and leg 0 CLAIMS the `transactionId`. A partial unique
  index over the claiming legs (`LedgerEntry_transactionId_claim_key`,
  `WHERE "legIndex" = 0`) is what refuses a second claim. A second posting
  raises `DuplicateLedgerTransactionError` carrying the id, so the caller can
  tell a duplicate from a genuine write failure -- the read-then-write it
  replaced could not, because a duplicate and a first posting looked the same
  to it. The read is gone from `postTransaction` entirely: keeping it would
  have left the guarantee resting on a read again, just with an index behind
  it.

  The migration (`prisma/migrations/20260928040000_ledger_transaction_claim`)
  is additive -- a column, a backfill, an index, nothing dropped. Legs posted
  before the migration are numbered by it (oldest first, one leg 0 per
  transaction) precisely so history is claimed too; without that backfill,
  re-posting a pre-migration `transactionId` would still have been free.

  It refuses nothing, and the reason is worth more than the check it replaced.
  The first draft opened with a precheck counting `GROUP BY "transactionId"
  HAVING COUNT(*) > 1`, which is true of every healthy transaction in the
  table: `assertLegsValid` rejects a single-leg set, so a correct ledger is one
  where that count is never 1. That precheck refused to apply to any database
  holding a single posted transaction -- seeded, staging or production -- and
  it got through because `ci/local.sh` migrates an EMPTY database, where there
  is no row to miscount.

  No rewrite of it is sound, either. Before this migration a row carries
  nothing that says which posting it belongs to, so "posted twice" and "posted
  once, with twice the legs" are the same table and no statement can tell them
  apart. What IS decidable is the claim, and the backfill decides it: legs
  numbered partitioned BY `transactionId` give every existing id exactly one leg
  0 by construction, so the index cannot fail to be built. The index is the
  check, and there is nothing left for a precheck to catch.

  **The migration is now executed against a database holding ledger rows**
  (`src/__tests__/ledger-transaction-claim-migration.test.ts`, run by CI's
  `migrations` job and by `ci/local.sh`): it builds a throwaway database from
  this repo's own earlier migrations, seeds two ordinary balanced
  transactions, applies the file, and asserts what the database did. It also
  runs the removed precheck verbatim against that same healthy data and
  requires it to raise -- so the reason it is gone is a database refusing,
  not a paragraph asserting it would have. Reinstating the precheck fails
  seven of the nine tests. This was verified on a real Postgres 16; the test
  skips with a printed warning, rather than passing quietly, when no database
  is reachable.

  The four existing `updateMany` claims (settlement webhook, `approvePayout`,
  `approveRefund`, the escrow sweep) are kept, each with the reason written
  next to it: the index would stop the double posting anyway, but by aborting
  the caller's whole transaction and reporting a duplicate, where the claim
  stops the loser before it writes anything and reports what actually
  happened. `createRefund` has no claim and needs none -- its Refund row was
  created a statement earlier, so its id has never been posted.

  **No caller catches `DuplicateLedgerTransactionError`, deliberately.** Each of
  the four keys its `transactionId` on a row it has already claimed, or on one
  it created a statement earlier, and nothing in `src/` ever moves a Payout
  back to DRAFT or a Refund back to REQUESTED -- so a second post of the same
  id is unreachable, and a legitimate retry is answered by the caller's own
  claim (`settled: false`, `InvalidPayoutStatusError`,
  `InvalidRefundStatusError`, `false` from the sweep) rather than by this.
  What remains is a claim and a ledger disagreeing about money that has moved,
  and that stays loud: the webhook 500s with the event unprocessed so the
  provider's retry resumes it, and the sweep logs one payment and continues.

  Verified: `LedgerEntry.legIndex` has exactly one write path outside the
  migration (`postTransaction`'s `createMany`; no `update`/`upsert` of a
  ledger entry exists in `src/`), the tests this touches, `npx prisma migrate
  deploy` on an empty database with `migrate diff` empty afterwards, and the
  ratchet (tsc 47, lint 193, both at baseline). CI's `migrations` job still
  proves the migration applies to an empty Postgres and leaves
  `schema.prisma` unchanged, which is the reason a partial index is invisible
  to `migrate diff` (the same arrangement as `Payment_donationId_paid_key`).

