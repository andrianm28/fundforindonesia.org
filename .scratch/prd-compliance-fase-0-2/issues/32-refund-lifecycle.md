# 32: Refund lifecycle end to end

**What to build:** An Admin can actually return a Donor's money, with the same two-person protection as a Payout, and the Donor supplies their account through a private link.

**Blocked by:** 13, 31, 8

**Status:** done
PR #130, #132, #153

- [ ] Status moves Requested, AwaitingDonorDetails, Approved, Processing, Completed, with rejection from the first two and failure from Processing returning to AwaitingDonorDetails
- [ ] Creating a Refund immediately moves the money by journal to Frozen Balance, so it stops being available and cannot join a Payout
- [ ] The Donor receives a signed link, valid 30 days, that opens only a bank account form and reveals nothing else; an expired link can be reissued at any time and the money stays frozen meanwhile
- [ ] A Verifier checks the destination account and the holder name against the Donation; an anonymised Donation cannot be refunded through the system
- [ ] The creating, approving and completing Admins are subject to the same distinctness rule as Payout
- [ ] Completion requires proof of transfer
- [ ] Completion drains the Provider Balance: the paid Gross is credited out
      of `GATEWAY_CLEARING` (the leg builder `refundPaidLegs`, added by
      prd-compliance 28c in PR #83, has no caller until this step calls it),
      so that account stops being debited by every settlement and credited by
      nothing
- [ ] The Donor is emailed when the Refund is created, when details are needed, and when the money is sent; the Fundraiser is told the effect on Campaign Balance

## Comments

- 2026-09-25 (architecture review): Admins never act as Admin on their own Campaign (CONTEXT.md, Admin). The Refund "complete" step must refuse an Admin who is the Campaign's Fundraiser, the same as create and approve (see `.scratch/campaign-rule-bugs/issues/02`).
- 2026-09-27 (review of PR #83, prd-compliance 28c): **the COMPLETED step
  owes more than a status change — it owes the Provider Balance its first
  credit.** `GATEWAY_CLEARING` is debited with the full Gross of every
  settlement and, as of PR #83, credited by nothing at all: the Payout-side
  credit is prd-compliance 27 (PR #73, unmerged) and the Refund-side leg
  builder exists but has no caller. This ticket is the only thing that can
  call `refundPaidLegs`, so until it does, that account's balance means
  "money collected and never withdrawn" rather than "money the provider
  holds", and ADR 0011's reconciliation invariant
  (`Provider Balance = GATEWAY_CLEARING − what has been withdrawn`) cannot be
  stated. Post the leg in the same transaction that marks the Refund
  COMPLETED, never on approval: approval moves no money.
- 2026-09-27 (same review): **rejecting a Refund must unwind the freeze, and
  this is not optional bookkeeping.** There is no such path today —
  `refundRequestedLegs` freezes at create time, and nothing anywhere credits
  `FROZEN_BALANCE`, `PLATFORM_FEE` or `REFUND_COST` back. It is deferred
  rather than forgotten: the only code that can reject one is this ticket's,
  since `createRefund`/`approveRefund` (src/lib/money/refunds.ts) never
  produce anything past `APPROVED`.
  The reason to insist on the unwind here rather than file it separately is
  that the cap in `createRefund` already assumes it. The cumulative check
  counts only refunds whose status is not `REJECTED`/`FAILED`, so a Refund
  that is frozen, then rejected without an unwind, hands its whole cap slot
  back while keeping the money frozen — and the next Refund for that Payment
  is approved against a cap that no longer reflects the money already gone.
  Nothing downstream catches it: `refundRequestedLegs` validates only that
  the two fee portions fit inside the refunded amount, and never reads the
  pool, so the second freeze debits `ESCROW_HOLD`/`CAMPAIGN_BALANCE` straight
  past zero into a negative balance. (Shortfall is detected later, at
  approval, and only after the damage.)
  One correction to the way this was first described, since it would have
  sent whoever writes it the wrong way: unwinding does **not** break the
  Impact page. The exact reversal of `refundRequestedLegs` — DEBIT
  `FROZEN_BALANCE` the full amount, CREDIT the source its _net_ share, CREDIT
  `PLATFORM_FEE` and `REFUND_COST` their portions — puts all six lines back
  where they were and still totals `collected`, because the freeze is
  balanced. Two plausible slips are caught loudly: unwinding the pool for the
  refunded amount rather than its net share leaves the six lines totalling
  92 000 against a `collected` of 100 000, and unwinding only the fee legs
  leaves 16 000 against 100 000 — the route answers 500 either way.
  The slip the page _cannot_ catch is the one that stays balanced while
  putting the money in the wrong place: DEBIT `FROZEN_BALANCE` 100 000 /
  CREDIT the source 100 000 reconciles perfectly while leaving the Campaign
  claiming 100 000 it never held and the platform reporting no fee retained.
  Conservation cannot see that, because every transaction still balances —
  see the honesty note in `src/app/api/impact/route.test.ts`. Reverse the
  freeze exactly, leg for leg, or not at all.
