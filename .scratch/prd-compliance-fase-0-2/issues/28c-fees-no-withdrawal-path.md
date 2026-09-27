# 28c: Platform and Provider Fees have no withdrawal path

**What to build:** `GATEWAY_CLEARING` is credited by every Refund and every
fee that the platform absorbs, and nothing ever debits it. The account
accumulates money that the ledger says is owed to someone. Payout
completion (ticket 27) drains the Campaign's `PAYOUT_CLEARING` correctly,
which is why the imbalance is only visible now: the payout side closes and
the clearing side keeps growing.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A refund that returns Platform Fee or Provider Fee takes it out of
      `GATEWAY_CLEARING` in the same transaction that returns the rest, or
      lands it in an account whose name says what it is owed for
- [ ] The Provider Balance still reconciles: the amount credited to the
      Campaign is unchanged, and the difference is accounted for rather
      than absorbed silently
- [ ] Impact & Transparency still holds its invariant: the six lines still
      total the collected figure after a refund, since a fee that was
      counted and then returned must leave the page the same way
- [ ] Whatever account absorbs the remainder is named for its purpose, so a
      later reader is not left guessing which side owns the balance

## Comments

- 2026-09-27 (raised by the independent review of PR #73): not a defect in
  Payout completion, but the same shape of hole as the one ticket 27
  already had to close for Volunteer Trip. It is recorded now, while the
  reviewer has pointed at it, because the next person to notice a
  never-draining account will otherwise rediscover it from scratch.
- The Risk: this is money the ledger currently claims is owed and never
  resolves. It does not make a Donor or Fundraiser wrong today, because no
  Refund has been taken through the system yet, which is exactly the reason
  to fix it before one is.
