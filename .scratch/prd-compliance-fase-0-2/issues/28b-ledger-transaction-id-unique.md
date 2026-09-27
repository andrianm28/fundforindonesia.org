# 28b: Ledger transaction id is not unique, so posting is read-then-write

**What to build:** `postTransaction`'s idempotency check reads for an
existing `transactionId` and then writes. That is a read-then-write, not a
constraint, so two callers racing the same transaction can both see "absent"
and both insert. Today it is safe only because the Payout row itself is
claimed first by an `updateMany`, so the losers fail there. That safety is
incidental to the caller, not a property of the ledger.

**Blocked by:** None (can start immediately)

**Status:** done (PR #82, dc602c2)

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
  is additive -- a column, a backfill, an index, nothing dropped -- and it
  refuses to apply while any `transactionId` is already posted more than
  once, naming the offenders. Legs posted before the migration are numbered
  by it (oldest first, one leg 0 per transaction) precisely so history is
  claimed too; without that backfill, re-posting a pre-migration
  `transactionId` would still have been free.

  **The duplicate check could not be run against a real database here** --
  none was reachable from the session that wrote this. What was established
  instead: no database this repo can create holds a single LedgerEntry row
  (neither `prisma/seed.ts` nor `tests/e2e/seed-e2e.ts` writes one), and
  every `transactionId` in `src/` is namespaced by something already unique
  (`WebhookEvent`'s `@@unique([provider, providerEventId])`, or a cuid row
  id), so two distinct movements cannot collide by construction. The
  production database still has to answer for itself before the deploy, with
  `SELECT "transactionId", COUNT(*) FROM "LedgerEntry" GROUP BY
  "transactionId" HAVING COUNT(*) > 1;` -- zero rows, or the migration stops
  and prints the offenders. That query is in the PR body for the owner.

  The four existing `updateMany` claims (settlement webhook, `approvePayout`,
  `approveRefund`, the escrow sweep) are kept, each with the reason written
  next to it: the index would stop the double posting anyway, but by aborting
  the caller's whole transaction and reporting a duplicate, where the claim
  stops the loser before it writes anything and reports what actually
  happened. `createRefund` has no claim and needs none -- its Refund row was
  created a statement earlier, so its id has never been posted.

  Verified: the 23 test files this touches (418 tests), `npx prisma
  validate`, and the ratchet (tsc 47, lint 193, both at baseline). CI's
  `migrations` job proves the migration applies to an empty Postgres and
  leaves `schema.prisma` unchanged, which is the reason a partial index is
  invisible to `migrate diff` (the same arrangement as
  `Payment_donationId_paid_key`).

