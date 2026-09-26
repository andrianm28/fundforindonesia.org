## Problem Statement

A Volunteer (or a Fundraiser cancelling an under-quota Batch) can cancel a `HOLD`
Registration with no Refund created — correct, since its Payment hasn't settled yet,
there is nothing to return. But neither cancel route touches the underlying Payment,
which stays `PENDING`. If that Payment's charge clears at the provider around the same
moment — a VA/QRIS payment can settle well after the 30-minute hold window closes, the
same timing gap ticket 03 already found for the "hold merely expired" case — the
settlement webhook races the cancellation:

- If the webhook wins (commits first), the Registration flips to `CONFIRMED`, and the
  cancel attempt's own predicate-based claim then correctly fails with 409. Safe.
- If the cancel wins (commits first), the Registration is already `CANCELLED` by the
  time the webhook's `registration.updateMany({where:{status:'HOLD'}})` runs. That
  update matches zero rows, so `registrationConfirmed` is `false` — but the webhook's
  transaction still commits: the Payment settles `PAID`, the ledger legs still post
  (crediting the Trip's Escrow Hold or Trip Balance), no notification is sent, and a
  `console.error` fires that says "hold likely already expired" — misleading here, since
  it was explicitly cancelled, not merely timed out.

The result: a Volunteer who explicitly cancelled gets nothing back, and their money
still lands in the Trip's balance with no seat and no Refund — discoverable today only
by grepping server logs. Nothing in the reconcile report or anywhere else surfaces this.

Ticket 05's own final review added row-locking to the Batch-cancel path, but that fix
closes a *different* race (the webhook confirming a Registration the batch-cancel is
about to iterate over) — not this one. No amount of database-side locking closes this
specific race, because the underlying charge is already in flight at the payment
provider before the cancellation request ever reaches this platform; locking only
sequences the two writes, it cannot make the provider's charge un-clear.

This affects both cancellation paths identically (`PATCH /api/registrations/[id]`'s
`HOLD` branch, and `PATCH /api/volunteer-trips/[slug]/batches/[id]`'s `cancel` action's
`HOLD` handling) — both just flip `Registration.status` to `CANCELLED` with no
awareness of the Payment's independent, concurrent lifecycle.

## Solution

When the settlement webhook finds a Trip Payment's Registration is no longer `HOLD`,
read its actual current status rather than only knowing "not HOLD." If it is
specifically `CANCELLED` (as opposed to, say, naturally `EXPIRED` via the hold-expiry
sweep — a materially different, still-open case, see Out of Scope), automatically
create a full Refund for the settled Payment, in a separate transaction after the
settlement itself commits.

Automatically creating the Refund only gets a Volunteer's money most of the way back:
without any way to discover a `REQUESTED` Refund exists, it sits invisible until
someone happens to know its id. No route or report anywhere in this codebase currently
lists pending Refunds — this is true for every Refund, not only auto-created ones, and
it becomes actively harmful once a webhook can create one with no human present to note
the id. This spec's second, necessary piece closes that: the reconcile report gains
visibility into every `REQUESTED` Refund awaiting approval.

## User Stories

1. As a Volunteer whose Trip Fee charge clears just after I cancelled my `HOLD`
   Registration, I want my money refunded automatically, so that I am not left having
   explicitly said "I don't want this" while my money sits uncredited to me anywhere.
2. As an Admin, I want a `REQUESTED` Refund created by this automatic path to be
   discoverable somewhere, so that I can actually approve it rather than it sitting
   invisible.
3. As an Admin, I want every `REQUESTED` Refund — not only the auto-created kind — to
   be discoverable the same way, so that the money-visibility report doesn't have a
   blind spot for the ordinary Admin-created case either.
4. As a developer reading the webhook, I want the settlement transaction's own
   lock-ordering discipline (Campaign/VolunteerTrip locked before Payment, documented in
   `escrow.ts`) to remain intact, so that this fix does not reintroduce the deadlock
   class that discipline exists to prevent.
5. As a developer, I want a Registration that is naturally `EXPIRED` (the hold-expiry
   sweep, not a deliberate cancellation) to keep its existing, unchanged behavior — log
   only, no auto-refund — so this fix does not silently expand into resolving ticket
   03's still-open, more ambiguous "what to do about a naturally expired hold that then
   settles" product question.
6. As a Volunteer, I want the auto-created Refund's presence to not depend on my own
   approval or a second action from me, so that the fix does not require building any
   donor-facing surface that doesn't exist yet.
7. As an Admin, I want the auto-created Refund's `reason` field to say plainly that this
   was a system-detected settlement-after-cancellation, not a generic string, so I don't
   have to guess why it exists when I go to approve it.
8. As a developer, I want a failure while creating this automatic Refund (e.g., a
   demo-Campaign-style guard, though Trip Fee has no equivalent, or an unexpected
   database error) to be logged loudly and not fail the webhook's response to the
   provider, since the underlying money has already genuinely settled by that point.

## Implementation Decisions

**Webhook (`src/app/api/webhooks/[provider]/route.ts`), inside the existing `paid`
branch's settlement transaction:**

- Where `registrationConfirmed` is currently computed from the `registration.updateMany`
  count alone, additionally read the Registration's actual current `status` (a plain
  `select`, not a `FOR UPDATE` read — no new lock needed here) when the update matched
  zero rows. Carry this status out of the transaction (e.g. as part of the returned
  `settled` object: `{ settled: true, registrationConfirmed, cancelledRegistration:
  { id, volunteerId, tripId, paymentAmount } | null }`) rather than acting on it inside
  the transaction — see the lock-ordering note below for why.
- **Do not call `createRefund` from inside this transaction.** `createRefund` locks the
  subject (`Campaign`/`VolunteerTrip`) before the `Payment` row, matching this
  codebase's established Campaign/VolunteerTrip-then-Payment lock order
  (`approvePayout`, `approveRefund`, `releaseMaturedEscrow` all use it, and `escrow.ts`
  documents at length why the settlement webhook is the one deliberate exception that
  locks nothing explicit and only gets away with it because it never contends with those
  other paths on the same Payment). This transaction has already written the Payment row
  (via its own `updateMany`) before reaching this branch — calling `createRefund` here
  would lock `VolunteerTrip` *after* already holding `Payment`, the reverse of the
  established order, reintroducing exactly the deadlock class `escrow.ts`'s own comment
  warns about. Instead, after this transaction commits, in the same post-transaction
  block where `notifyRegistrationConfirmed`/`notifyDonationConfirmed` already run
  (outside any transaction, on the documented principle that a failure here must not
  roll back money that has genuinely settled): if `cancelledRegistration` is set, open a
  **fresh** `prisma.$transaction` and call `createRefund` with `subject: {type:'trip',
  tripId: cancelledRegistration.tripId}`, `paymentId: payment.id`, `amount:
  payment.amount` (the full Gross — this Registration was cancelled before any
  commitment period began, so the tiered `tripFeeRefundAmount` rule doesn't apply; this
  mirrors the Batch-cancellation path's own unconditional full refund, not the
  Volunteer-self-cancels-a-CONFIRMED-Registration tiered path), `reason: 'Trip Fee
  settlement arrived after the Registration was already cancelled -- refunded
  automatically'`, `requestedById: cancelledRegistration.volunteerId` (there is no admin
  actor in this flow; attributing the request to the Volunteer whose own cancellation
  set this in motion mirrors how the existing self-cancel route already attributes its
  own, human-triggered Refund creation to the cancelling Volunteer).
- Wrap this new post-transaction call in its own `try`/`catch`: a failure here (e.g. an
  unexpected error inside `createRefund`) is logged with `console.error` naming the
  payment and registration ids, exactly like the existing "lost the settlement race"
  log, and does not throw — the webhook must still return 200 to the provider, since the
  underlying settlement already committed successfully.
- The `failed`/`expired` branch is unaffected — a Registration racing to `EXPIRED` there
  is already correctly idempotent (see the existing comment on that branch); this
  Solution only concerns the `paid` branch.
- Only a `CANCELLED` current status triggers the new auto-refund path. Any other
  non-`HOLD` status found (in practice, only `EXPIRED` is reachable today) keeps the
  existing log-only behavior unchanged.

**Reconcile (`src/app/api/admin/reconcile/route.ts`):**

- New `pendingRefunds` array in the returned report: every `Refund` whose `status` is
  `REQUESTED`, across both Campaign and Trip subjects (resolved the same way
  `strandedEscrow`'s existing Campaign-or-Trip branch already does, via
  `Refund.payment.donationId`/`.registrationId`). One combined array, not
  Campaign/Trip-split siblings like the escrow checks — a pending-approval work queue
  has no reason to be partitioned by subject type the way a balance check does; an Admin
  approving Refunds wants one list. Include `refundId`, `paymentId`, `amount`, `reason`,
  `requestedById`, `createdAt`, and which subject it belongs to (`campaignId` or
  `volunteerTripId`).
- This is not scoped to only the auto-created kind — every `REQUESTED` Refund, created
  by an Admin via `POST /api/campaigns/[slug]/refunds` or by this new automatic path,
  belongs in the same list. There is currently no other way to discover a `REQUESTED`
  Refund exists anywhere in this codebase.

## Testing Decisions

**Seams under test, following this codebase's own established split for money-movement
features:**

- `POST /api/webhooks/[provider]` (the webhook route handler), called directly with
  `@/lib/prisma` mocked — mirrors this file's own existing test file
  (`route.test.ts`), which already covers the `paid`/`failed`/`expired` branches and the
  Trip-vs-Campaign split. Cover every edge case through this seam: a settlement whose
  Registration is found `CANCELLED` (auto-refund created, with the exact `amount`,
  `reason`, `requestedById`, and `subject` asserted), a settlement whose Registration is
  found `EXPIRED` (existing log-only behavior, unchanged, no Refund created — a
  regression test proving this fix did not widen scope), a settlement whose
  `createRefund` call throws (webhook still returns 200, still logs, the already-settled
  Payment/ledger state from the first transaction is untouched), and confirm the
  auto-refund's `$transaction` is a genuinely separate one from the settlement's own (not,
  say, accidentally reusing the same `tx` reference after it's already been committed).
- `src/app/api/admin/reconcile/route.ts`'s exported `GET`, called directly with
  `@/lib/prisma` mocked — mirrors this file's own existing test file. Cover: a
  Campaign-linked `REQUESTED` Refund appears in `pendingRefunds`; a Trip-linked one does
  too, in the same array; a Refund whose status is `APPROVED`/`REJECTED`/anything other
  than `REQUESTED` does not appear; an empty case (no pending refunds) returns an empty
  array, not an absent field.

Only test external behavior through these seams — what the webhook actually posted to
the ledger/database and what the route returned, never internal call counts or mock
call order. Prior art: `src/app/api/webhooks/[provider]/route.test.ts` and
`src/app/api/admin/reconcile/route.test.ts`, both already covering the exact patterns
(Trip-vs-Campaign branching, `@/lib/prisma` mocked directly) this ticket extends.

## Out of Scope

- The "hold merely expired" case (a Registration that lapses via the hold-expiry sweep,
  not a deliberate cancellation) is deliberately left exactly as ticket 03 shipped it —
  log only, no auto-refund, no re-offered seat. That remains an open product decision
  (refund? re-offer the seat if quota allows?) explicitly flagged by ticket 03's own
  final review and not resolved here. Conflating it with this ticket's unambiguous
  "the Volunteer explicitly cancelled" case would be scope creep past what was asked.
- Any donor/Volunteer-facing notification about the auto-created Refund. No Refund
  notification of any kind exists anywhere in this codebase yet (the Refund API ticket's
  own Out of Scope already deferred all three PRD-specified donor emails); this ticket
  does not add the first one.
- A UI or dedicated route for listing/approving pending Refunds beyond the existing
  `PATCH /api/campaigns/[slug]/refunds/[id]/approve` (which this ticket's reconcile
  addition feeds — an Admin reads the id from `pendingRefunds` and calls the existing
  approve route by hand). No Trip-scoped Refund-approval route exists yet either
  (deliberately deferred by the Refund API ticket); this ticket does not add one.
- Voiding or cancelling the underlying Payment when a `HOLD` Registration is cancelled.
  Considered and rejected as an approach: it narrows the race window but cannot close it
  (a charge can clear at the provider before this platform ever processes a "void"
  instruction), and this platform has no provider-side cancel-a-pending-charge API to
  call regardless. The auto-refund approach handles the race's actual outcome instead of
  attempting to prevent an unpreventable timing window.
- Any change to `createRefund`/`approveRefund`'s own signatures or locking discipline.
  This ticket is a caller of the existing, already-generalized `createRefund` — it does
  not modify the money layer itself.

## Further Notes

- This is the second time this exact class of bug has surfaced from the same root
  cause: a Trip Fee's hold window and its charge's actual provider-side validity window
  don't agree, and nothing re-syncs a Registration's fate with a Payment's independent,
  asynchronous lifecycle once they diverge. Ticket 03's fix handled the first
  manifestation (natural expiry); this spec handles the second (explicit cancellation).
  If a third manifestation surfaces later, it may be worth asking whether the underlying
  timing mismatch itself should be closed (e.g., shortening the charge's own validity
  window to match the hold window) rather than patching each new discovery site
  individually.
- `pendingRefunds`' addition to reconcile is not scoped narrowly to "refunds this
  specific bug creates" on purpose — it closes a real, pre-existing gap (no Refund,
  auto-created or not, has ever been discoverable after creation) that this ticket's own
  fix would otherwise make actively worse, not just leave as-is.
