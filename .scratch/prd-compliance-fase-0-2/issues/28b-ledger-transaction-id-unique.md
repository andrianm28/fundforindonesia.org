# 28b: Ledger transaction id is not unique, so posting is read-then-write

**What to build:** `postTransaction`'s idempotency check reads for an
existing `transactionId` and then writes. That is a read-then-write, not a
constraint, so two callers racing the same transaction can both see "absent"
and both insert. Today it is safe only because the Payout row itself is
claimed first by an `updateMany`, so the losers fail there. That safety is
incidental to the caller, not a property of the ledger.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Re-posting a `transactionId` that already exists is refused by the
      database, not merely by a preceding read
- [ ] The refusal is a clear duplicate rather than a unique-violation
      stack trace, and the caller can distinguish it from a genuine failure
- [ ] A concurrent double-post of the same id leaves exactly one row
- [ ] Existing callers that already guard with `updateMany` keep working
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
