## Problem Statement

Reconcile's `pendingRefunds` array (added by the cancelled-registration settlement
race fix) lists every `REQUESTED` Refund, Campaign or Trip, as a work queue for an
Admin to approve. But only one approval route exists: `PATCH
/api/campaigns/[slug]/refunds/[id]/approve`, which 404s on any Refund whose Payment
isn't Campaign-linked. Every Trip-linked Refund `pendingRefunds` surfaces — created by
the Volunteer self-cancel route, the Fundraiser Batch-cancel route, or the settlement
webhook's own auto-refund, all of which already exist and already create real Refund
rows — is discoverable but permanently unapprovable through any route in this
codebase. An Admin who finds one in the report has no action to take.

## Solution

Add `PATCH /api/volunteer-trips/[slug]/refunds/[id]/approve`, mirroring the existing
Campaign route almost exactly: `approveRefund` (`src/lib/money/refunds.ts`) already
resolves a Refund's subject internally and needs no Trip-specific logic at all — the
only thing genuinely Campaign-specific about the existing route is its own lookup
(finding the Campaign by slug, checking the Refund's Payment belongs to it). The new
route does the identical job scoped to `VolunteerTrip` instead.

No create route is added. Unlike Campaign (whose simplest refund trigger is an Admin
directly creating one for "Donor salah bayar, ganda, atau salah Campaign" — an
always-available, no-dedicated-trigger case `POST /api/campaigns/[slug]/refunds`
exists for), every Trip Fee refund trigger already has its own dedicated call site
(self-cancel, batch-cancel, the settlement race auto-refund) that calls `createRefund`
directly. There is no analogous "Admin manually creates an ad-hoc Trip refund" need
identified anywhere in this codebase's Volunteer Trip spec or tickets — adding one
would be scope creep past the actual, diagnosed gap (approval, not creation).

## User Stories

1. As an Admin, I want to approve a Trip-linked Refund that `pendingRefunds` shows me,
   so that a Volunteer whose money was correctly frozen (by their own cancellation, a
   Batch cancellation, or the settlement-race auto-refund) actually gets it back.
2. As an Admin, I want the same two-person rule enforced for a Trip-linked Refund as
   for a Campaign-linked one — I cannot approve a Refund I requested myself.
3. As an Admin, I want a 404 if the Refund's Payment doesn't actually belong to the
   Trip named in the URL, mirroring the Campaign route's own scoping check exactly.
4. As an Admin, I want a 409 if the Refund is no longer `REQUESTED` (already
   approved/rejected by someone else), not a silent success.
5. As a Verifier without the Admin assignment, I want this route to refuse me the same
   way the Campaign route already does, so the two routes enforce authorization
   identically.
6. As a developer, I want this route to call the same `approveRefund` function the
   Campaign route already calls, unchanged, so Trip and Campaign refund approval share
   one code path for the money-movement logic itself and only differ in their own
   Trip-vs-Campaign scoping lookup.

## Implementation Decisions

- New route: `src/app/api/volunteer-trips/[slug]/refunds/[id]/approve/route.ts`,
  `PATCH`, gated `withAssignmentCheck(Assignment.ADMIN, ...)` — identical gating to the
  Campaign route.
- Lookup: `prisma.volunteerTrip.findUnique({ where: { slug }, select: { id: true } })`;
  404 (`'Volunteer trip tidak ditemukan'`) if not found — mirrors this codebase's own
  established not-found message convention for VolunteerTrip lookups elsewhere (e.g.
  the registration route).
- Scoping check: `prisma.refund.findUnique({ where: { id }, select: { payment: {
  select: { registration: { select: { batch: { select: { tripId: true } } } } } } }
  })`; 404 (`'Refund tidak ditemukan'`) if the refund doesn't exist OR
  `refund.payment.registration?.batch.tripId !== trip.id` — the exact structural
  mirror of the Campaign route's `refund.payment.donation?.campaignId !== campaign.id`
  check.
- Call `approveRefund(prisma, { refundId: id, approvedById })` — the same function,
  same signature, same import, as the Campaign route. Do not modify
  `src/lib/money/refunds.ts` at all; it is already subject-agnostic.
- Success response shape identical to the Campaign route's: `{ id, paymentId, amount,
  status, approvedById }`.
- Error mapping identical to the Campaign route's: `RefundNotFoundError` → 404
  (`'Refund tidak ditemukan'`), `SelfApprovalError` → 403 (`'Refund tidak dapat
  disetujui oleh orang yang mengajukannya'`), `InvalidRefundStatusError` → 409
  (`'Refund tidak lagi menunggu persetujuan'`), anything else → `console.error` + 500
  (`'Gagal menyetujui refund'`).

## Testing Decisions

**Seam under test:** `PATCH /api/volunteer-trips/[slug]/refunds/[id]/approve` (the
exported route handler), imported and called directly with `@/lib/prisma` and
`@/lib/money/refunds`'s `approveRefund` mocked, mirroring
`src/app/api/campaigns/[slug]/refunds/[id]/approve/route.test.ts`'s own seam and
structure exactly (same mocking strategy: `approveRefund` itself is mocked at the
module level here too, since its own correctness is already fully proven by
`src/lib/money/refunds.test.ts` — this route's own test responsibility is call-site
wiring and HTTP-layer concerns, not re-proving the money logic).

Cover every case the Campaign route's own test file already covers, adapted to Trip:
401 unauthenticated; 403 for a non-Admin-assigned session; 404 when the Trip doesn't
exist; 404 when the Refund's Payment belongs to a different Trip than the URL slug (or
is Campaign-linked entirely — the mirror-image of the Campaign route's own
different-subject 404); 404 when the refund id doesn't exist at all; 200 approving a
REQUESTED refund; 403 when the approver is the same person who requested it; 409 when
the refund is no longer REQUESTED.

Prior art: `src/app/api/campaigns/[slug]/refunds/[id]/approve/route.ts` and its test
file — read both in full before writing this route; the new route is a structural
mirror, not a fresh design.

## Out of Scope

- Any `POST /api/volunteer-trips/[slug]/refunds` create route — see Solution for why
  none is needed; every Trip Fee refund trigger already has its own dedicated creation
  call site.
- Any change to `src/lib/money/refunds.ts` (`createRefund`/`approveRefund`) — both are
  already subject-agnostic and need no Trip-specific logic.
- Any UI for approving refunds. API only, matching the Campaign route's own scope.
- A `GET` listing route scoped to one Trip's own refunds — `pendingRefunds` in
  reconcile already lists every Trip-linked Refund across all Trips; a per-Trip filter
  wasn't identified as needed by the finding that motivated this ticket.

## Further Notes

This closes the specific gap the cancelled-registration settlement race fix's final
whole-branch review flagged as "the next ticket": `pendingRefunds` showing Admins
Trip-linked Refunds they had no route to act on. Consider, once this ships, whether
`pendingRefunds`' response should still carry a note for any Refund type that has no
approval route — none should exist after this ticket, but the pattern (a report
surfacing something with no action available) is worth remembering if it recurs
elsewhere.
