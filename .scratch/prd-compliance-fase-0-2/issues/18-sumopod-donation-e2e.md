# 18: Sumopod QRIS Donation end to end with frozen terms

**What to build:** A Donor gives real money by QRIS without an account, and the terms they were shown are the terms that apply no matter what an Admin changes afterwards.

**Blocked by:** 10, 17

**Status:** in review (PR #44)

- [x] A Guest Donor donates with email required, name and phone optional, and an anonymous option that hides them from the public and the Fundraiser
- [x] Minimum Rp20.000, with quick amounts and a free amount
- [x] Platform Fee, Provider Fee basis and Escrow Hold duration are copied onto the Payment at creation and shown before payment
- [x] Provider Fee is read from the provider payload, never assumed
- [x] A Payment expires after 24 hours; the Donor may retry with a new Payment on the same Donation, and at most one Payment ever settles
- [x] A Demo Campaign and a non-Active Campaign both refuse Donations
- [ ] The donations kill-switch is removed once this path is proven

## Comments

- 2026-09-26 (agent, PR below). What this ticket found already built (tickets
  9/10/17): Demo/non-Active Campaign refusal, Provider Fee read from the
  webhook payload, and Platform Fee freezing were already merged and needed
  no change here beyond a couple of consistency fixes.
  What this PR adds:
  - Guest Donor: `guestEmail` (required when there is no session),
    `guestName`, `guestPhone` on `Donation`, protected the same way as
    `User.email`/`phone` (ADR 0012, `src/lib/field-protection.ts`). The
    public donations list now shows a non-anonymous guest's name instead of
    always "Anonim".
  - Minimum amount raised to Rp20.000 in the API (`POST /api/donations`),
    matching the donate page's own `MIN_AMOUNT` which was already 20.000.
  - `Payment.escrowHoldDays` frozen at creation from `ESCROW_HOLD_DAYS`, read
    by the settlement webhook instead of the live constant, and shown next
    to the Platform Fee rate on the campaign page.
  - Retry: `Payment.donationId` is no longer unique (a retry creates a new
    Payment on the same Donation after a `FAILED`/expired attempt, via
    `POST /api/donations/[id]/retry`). At most one Payment per Donation may
    ever reach `PAID`, enforced by a partial unique index
    (`Payment_donationId_paid_key`, `WHERE status = 'PAID'`) -- verified
    against a real local Postgres that a losing concurrent settlement is
    rejected by the database itself, not only by the app-level guard. The
    webhook catches that specific constraint violation and unwinds the
    transaction cleanly (logs for manual review; does not mark the losing
    Payment `FAILED`, since its money may genuinely have arrived).

  **Assumptions made, not decided by this ticket -- flagged for the owner:**
  1. Escrow Hold has no per-Kind/Category/Campaign Admin override yet (only
     Platform Fee does, per ticket 17). `escrowHoldDays` freezes the single
     global `ESCROW_HOLD_DAYS` constant. Building the override system itself
     is out of scope here; if the owner wants one, it is a follow-up ticket.
  2. Retry auth: a signed-in Donor's session must match the Donation's
     `donorId`; a Guest Donor's retry is authorized only by knowing the
     Donation's id (an unguessable cuid), same trust model as a Guest
     Donor's Receipt link elsewhere in this codebase. No stricter guard
     (e.g. a signed token) was added.
  3. Retry eligibility: allowed only when the last Payment is `FAILED`,
     `EXPIRED`, or `PENDING` past its own `expiresAt` (lazily flipped to
     `EXPIRED` on the way). A still-live `PENDING` Payment or an already
     `PAID` one refuses the retry with 409, rather than silently reusing or
     cancelling the earlier Payment.
  4. **Kill-switch (`NEXT_PUBLIC_DONATIONS_ENABLED`) is deliberately left
     in place, not removed.** No real Sumopod credentials exist yet (a
     separate ticket); everything here is proven against the provider
     adapter and its test doubles (`MockPaymentProvider`), never against a
     live webhook from the real Sumopod sandbox or production. Removing the
     switch is for the ticket that wires up real credentials and can watch
     a real settlement happen end to end.
