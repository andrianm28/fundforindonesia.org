# 33: A Refund can freeze Campaign money permanently, and nothing can undo it

**Type:** research

**Status:** ready-for-human

**Blocked by:** 13, 31, 8

## Question

A Refund **debites the Campaign's money at the moment it is created**, not when it
is paid. `createRefund` posts the freeze inside the same transaction that sets
`status: 'REQUESTED'` (`src/lib/money/refunds.ts`, freeze at :270, status at
:254). There is no path that returns it.

The enum has seven statuses (`prisma/schema.prisma`):

```
REQUESTED  AWAITING_DONOR_DETAILS  APPROVED  PROCESSING  COMPLETED  REJECTED  FAILED
```

**Only two have a production writer**: `REQUESTED` and `APPROVED`. The other five
appear only in `*.test.ts`. So:

- **`REJECTED` is never written.** An Admin who approves the wrong Refund has no
  way to undo it; "not acting" is the only release, and doing nothing is not a
  status. `CONTEXT.md` says the first person creates, the second approves, the
  third completes — so three steps are described and two exist.
- **`COMPLETED` is never written**, so `refundPaidLegs` (`ledger.ts:898`) has no
  production caller. The Donor is paid by hand in the provider's dashboard and
  **nothing records that it happened.** The `Refund` model
  (`prisma/schema.prisma:1470-1491`) has no `completedById`, no proof of transfer
  and no Donor token, so the third step has nowhere to write even if it existed.
- **`FAILED` is never written**, so nothing returns `FROZEN_BALANCE`.
- `FROZEN_BALANCE` is credited only at `ledger.ts:669` and debited only at
  `:731` (approve), which moves the money to `REFUND_CLEARING`, debited only by
  `refundPaidLegs`. **There is no code returning it to `ESCROW_HOLD` or
  `CAMPAIGN_BALANCE`.** A Campaign Balance that has been frozen stays negative.

This is not a feature that is unfinished. It is a feature that **can damage and
cannot be repaired**, and the operator has the button.

**Live today**, not latent: the freeze posts on create, there is no Refund UI so
the only path is the Admin API, and `DONATIONS_ENABLED` does not gate it.

## Why it is not just "write the missing statuses"

Adding `REJECTED` is necessary and not sufficient. Three decisions have to be
made first, and none of them are mechanical:

1. **Who may reject, and may they reject after approval?** A rejection after
   `APPROVED` has to move money back out of `REFUND_CLEARING`, which is a
   different leg from the one at freeze time. The two-person rule in
   `CONTEXT.md` covers create/approve/complete; a reject that undoes an approval
   needs its own rule, and it may need to be a third person.
2. **What does "the Donor was paid by hand in the provider's dashboard" mean in
   the books?** ADR 0006 records that Sumopod has no disbursement API, so this
   is manual by design. `completePayout` already solves the analogous problem
   for a Payout — a second Admin records the transfer with proof. Refund has no
   equivalent route, and that asymmetry is the thing to decide.
3. **Does an approved-then-never-paid Refund count against the Donor or the
   Campaign?** `FROZEN_BALANCE` is neither held in escrow nor owed to a Donor in
   the reporting, and `impact.ts` currently adds it to `heldInEscrowHold` and
   reports `REFUND_CLEARING` as `returnedToDonors` — both on the public,
   unauthenticated Impact page. A Donor reading that is told money came back
   before it has.

## Also wrong, and in the same ticket because it is the same money

- `src/lib/money/impact.ts:303` computes `returnedToDonors` from
  `REFUND_CLEARING:CREDIT` — money still clearing, never transferred. The page
  is `src/app/(static)/impact`, no auth.
- `src/lib/money/impact.ts:317` adds `FROZEN_BALANCE` to `heldInEscrowHold`, so a
  Donor's frozen money is reported as a Campaign still holding escrow.
- `escrow.ts:270` only excludes `REQUESTED` and `PROCESSING` from the sweep.
  `PROCESSING` cannot occur, so an `APPROVED` Refund that is never completed
  holds its money indefinitely. The watchdog at `escrow.ts:74` does report it,
  so this one is not silent.

## Notes

Surfaced 2026-09-28 by a read-only audit of the refund path, then verified
against the code: 58 Refund tests green and behaving exactly as documented. The
problem is that what is documented is not what was designed.

Ticket 32 (`32-refund-lifecycle.md`, `ready-for-agent`) is the intended home and
is blocked by 13, 31 and 8. This ticket is **not** a replacement for it — it
states the consequence that 32 has to answer, and the two decisions above that
have to be made before 32's checklist can be written. Its `Status:` line says
`ready-for-agent` and that is correct; what was missing was anyone recording
that the path can strand money.

Note that `Blocked by: 8` may itself be wrong — that blocker is `wontfix`, and a
ticket that cannot be unblocked by a `wontfix` blocker is worth re-examining
before 32 is scheduled.

## Comments

- 2026-10-03 (status sweep): `COMPLETED` kini ditulis oleh `completeRefund`
  (tiket 32), dan pelaporan Impact sudah dikerjakan ulang. Yang tersisa adalah
  `REJECTED` dan `FAILED`, yang masih tanpa penulis. Owner memutuskan
  pertanyaan 1: tolak hanya sebelum approve; Refund APPROVED yang gagal dibayar
  ditandai `FAILED`. Implementasinya tiket 49. Tiket riset ini selesai saat 49
  done.
