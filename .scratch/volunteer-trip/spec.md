# Spec: Volunteer Trip

Source: PRD `docs/PRD-fund-for-indonesia.md` (revisi 22 September 2026, §3, §4, FFI-11, FFI-12, §7 alur pengguna, §10, §11, §13, §14), `CONTEXT.md` (Volunteer Trip, Volunteer Batch, Registration, Trip Fee, Volunteer), ADR 0002, ADR 0007, [ADR 0014](../../docs/adr/0014-volunteer-trip-stays-separate-entity.md).

This spec covers Volunteer Trip: the paid, destination-based volunteering model a 22 September 2026 grilling session designed after the Traveling & Teaching reference program (1000 GURU Foundation), replacing the earlier placeholder scope FFI-11/FFI-12 previously described only as "Volunteer Event." It is Fase 3 scope, lower priority than the Fase 0/1 work already merged, and none of it exists in code yet — no model, no route, no test.

## Problem Statement

An aspiring Volunteer has no way today to discover a destination-based trip, see what it costs, and pay to secure a seat — the only thing recorded anywhere about "Volunteer" is a name on the supporting menu and two placeholder PRD rows (FFI-11, FFI-12). There is no model, no route, and no test behind it.

A Fundraiser who wants to run trips the way 1000 GURU's Traveling & Teaching does — recurring destinations, dated batches, a fee that covers the trip — has no platform surface for any of it. Today that coordination happens over WhatsApp and a manual bank transfer, which is exactly the scattered, untracked kind of channel the whole platform exists to replace (PRD §1: "satu akun dan satu riwayat dampak").

## Solution

Volunteer Trip becomes a Fundraiser-owned catalog item — destination, itinerary, Trip Fee — that can run multiple Volunteer Batches: dated instances of the same Trip, each with its own maximum and minimum quota. A Volunteer registers on a Batch and pays the Trip Fee to confirm; registering alone does not claim the seat, matching how a real capacity-constrained trip actually works — a Registration only becomes CONFIRMED, and only then counts against quota, once its Payment settles.

Deliberately **not** a fifth Campaign Kind ([ADR 0014](../../docs/adr/0014-volunteer-trip-stays-separate-entity.md)): a Trip Fee is cost-recovery for the Volunteer's own participation, not a contribution to the destination community, so Volunteer Trip stays a separate entity. It reuses Payment, the double-entry ledger, Escrow Hold, and Payout as shared money-movement primitives — the same collect-hold-release-payout mechanics Campaign already has — without adopting Campaign, Kind, or Donation vocabulary. Concretely, this spec generalizes already-shipped code (the ledger leg-builders, `postTransaction`, the escrow-release sweep, the payment webhook) to accept either a Campaign or a Volunteer Trip as their subject, rather than writing a parallel, duplicate set of money-movement functions.

## User Stories

1. As a Volunteer, I want to browse Volunteer Trips, so that I can find a destination that matches what I want to do.
2. As a Volunteer, I want a Trip's detail page to show its destination, itinerary, and Trip Fee, so that I can decide whether to join before picking a date.
3. As a Volunteer, I want to see every open Batch of a Trip with its date range and remaining quota, so that I can pick one that fits my schedule.
4. As a Volunteer, I want to register on a Batch and be told the seat is not yet mine until I pay, so that I'm not misled into thinking registering alone reserves my place.
5. As a Volunteer, I want my seat held for a limited window after registering, so that I have a fair chance to pay before someone else takes it, without the seat being lost to an abandoned registration.
6. As a Volunteer, I want my Registration to move to confirmed automatically once my Trip Fee payment settles, with no separate confirmation step, matching how a Donation's Payment settling is what makes it real.
7. As a Volunteer, I want a Receipt for my Trip Fee, matching what a Donor gets for a Donation, so I have proof of payment.
8. As a Volunteer, I want it to be clear the Receipt is for a Trip Fee, not a Donation, so that I don't mistake buying my own seat for a charitable contribution.
9. As a Volunteer, I want to cancel my own Registration and understand upfront how much of my Trip Fee I'll get back, so that I'm not surprised by the refund amount.
10. As a Volunteer, the closer my cancellation is to the Batch's departure, the less I expect to get back, matching how the reference program's real trip costs are pre-committed the closer departure gets.
11. As a Volunteer, if the Fundraiser cancels my Batch because it didn't reach its minimum headcount, I want a full refund regardless of timing, since the trip not happening was never my choice.
12. As a Volunteer, I want my registration history visible on my own dashboard, alongside my Donation history, so that everything I've contributed or participated in is in one place.
13. As a Volunteer, I want a digital certificate and a record of my participation after a Batch completes, so that I have something to show for it (unchanged from FFI-12).
14. As a Fundraiser, I want to create a Volunteer Trip with a destination, itinerary, and Trip Fee, so that I can list it once and reuse it across dates.
15. As a Fundraiser, I want to add a Batch to my Trip with its own date range, maximum quota, and minimum viable quota, so that I control both how many seats exist and whether the trip is worth running.
16. As a Fundraiser, I want my Trip to go through the same kind of review a Campaign does before it's publicly visible, so that Volunteer Trips carry the same credibility signal as everything else on the platform.
17. As a Fundraiser, I want to cancel a Batch that didn't reach its minimum quota by the registration deadline, so that I'm not forced to run a trip I can't actually afford.
18. As a Fundraiser, I want every already-paid Registration on a Batch I cancel to be refunded in full automatically, so that I don't have to process each refund by hand.
19. As a Fundraiser, I want to request a payout of my Trip's withdrawable balance, the same way I'd request a Campaign's Payout, so that receiving Trip Fee money doesn't require learning a second process.
20. As a Fundraiser, I want the two-person rule to apply to my Trip's payout exactly as it does for a Campaign's, so that money leaving the platform always has two different people involved, with no exception carved out for Volunteer Trip.
21. As a Fundraiser, I want to see my Trip's Escrow Hold and Trip Balance, the same way I'd see a Campaign's, so that I know what's pending versus withdrawable.
22. As a Verifier, I want a queue of submitted Volunteer Trips separate from the Campaign queue, so that reviewing one doesn't require scrolling past the other.
23. As a Verifier, I want to approve or reject a submitted Volunteer Trip with a reason, mirroring how I already review a Campaign.
24. As an Admin, I want Trip Fee payments to appear in daily reconciliation the same way Donation payments do, so that "where is the money" has one answer regardless of which product line it came from.
25. As an Admin, I want it to be structurally impossible for a Trip Balance to be paid out as if it were a Campaign Balance, or vice versa, so that money collected for one Trip or Campaign can never leave through the wrong door.
26. As an Admin, I want no Platform Fee taken from any Trip Fee, matching the platform's current precedent of not monetizing any contribution path yet, so that introducing Volunteer Trip doesn't quietly start platform monetization as a side effect.
27. As anyone reading the domain documentation, I want Volunteer Trip's separation from Campaign, and the reasoning for it, recorded as a decision rather than left to be reverse-engineered from the schema.
28. As a Volunteer whose Registration is still on HOLD, I want the seat released automatically if I never pay, so that an abandoned registration doesn't permanently lock out someone who's ready to pay.
29. As a Fundraiser, I want a Batch to stop accepting new Registrations once its maximum quota (counting both HOLD and CONFIRMED seats) is reached, so that I never oversell a physically limited trip.

## Implementation Decisions

### Schema

- New model `VolunteerTrip`: `id`, `slug` (unique), `fundraiserId` (→ `User`, same relation shape as `Campaign.creatorId`), `title`, `description`, `story`, `coverImage`, `destination`, `itinerary` (`String @db.Text`, free text — no structured leg-by-leg itinerary in this spec), `tripFeeAmount` (`Int`, rupiah, shared across every Batch of this Trip), `status` (new `VolunteerTripStatus` enum), `createdAt`, `updatedAt`. Mirrors `Campaign`'s shape deliberately, minus the fields that don't apply (`targetAmount`, `deadline`, `isUrgent`, `isDemo`) and plus the fields Campaign doesn't need (`destination`, `itinerary`, `tripFeeAmount`).
- New enum `VolunteerTripStatus`: `DRAFT`, `SUBMITTED`, `REJECTED`, `ACTIVE`, `SUSPENDED`, `CANCELLED`, `COMPLETED`. Deliberately omits `CampaignStatus`'s `EXPIRED` — a Trip has no single deadline of its own; expiry-like behavior happens per-Batch instead (a Batch's registration deadline passing), not on the Trip.
- New model `VolunteerBatch`: `id`, `tripId` (→ `VolunteerTrip`), `startDate`, `endDate`, `registrationDeadline`, `maxQuota` (`Int`), `minQuota` (`Int`, Fundraiser-set per Batch, not a platform-wide constant per ADR 0014), `status` (new `VolunteerBatchStatus` enum), `createdAt`, `updatedAt`.
- New enum `VolunteerBatchStatus`: `OPEN` (accepting Registration), `CLOSED` (deadline passed or `maxQuota` reached, no longer accepting Registration but not yet resolved), `CANCELLED` (Fundraiser cancelled for missing `minQuota`), `COMPLETED` (the Batch happened; certificates can be issued).
- New model `Registration`: `id`, `volunteerId` (→ `User`), `batchId` (→ `VolunteerBatch`), `status` (new `RegistrationStatus` enum), `holdExpiresAt` (`DateTime`), `createdAt`, `updatedAt`. A `payment Payment?` back-relation, mirroring `Donation.payment`.
- New enum `RegistrationStatus`: `HOLD`, `CONFIRMED`, `EXPIRED`, `CANCELLED`. `CONFIRMED` is the only status that counts toward `minQuota`; `HOLD` and `CONFIRMED` together count toward `maxQuota`. This is a denormalized status kept in sync with the Registration's `Payment.status` — the same dual-write shape this repo already uses for `Campaign.status`/`Campaign.lifecycleStatus`, including the same kind of standing test asserting no writer sets one without the other.
- `Payment.donationId` becomes nullable, and a new nullable, unique `registrationId` is added alongside it, with exactly one of the two ever set — the same "exactly one of several nullable FKs is set" shape `LedgerEntry` already uses for `paymentId`/`refundId`/`payoutId`. A `CHECK` at the application level (a guarded helper, not a schema constraint Prisma can express) refuses creating a `Payment` with both or neither set.
- `Payout.campaignId` becomes nullable, and a new nullable `volunteerTripId` is added alongside it, same exactly-one-of-two shape.
- `LedgerEntry.campaignId` stays as-is (already nullable); a new nullable `volunteerTripId` is added alongside it. An entry belonging to a Trip-scoped account (`ESCROW_HOLD` or the new `TRIP_BALANCE`, see below) sets `volunteerTripId` and leaves `campaignId` null; a Campaign-scoped entry does the reverse; a platform-level entry (e.g. `PROVIDER_FEE`) leaves both null, unchanged from today.
- `LedgerAccount` gains one new value: `TRIP_BALANCE`, the Trip-scoped sibling of `CAMPAIGN_BALANCE`. No other new account is added: `ESCROW_HOLD`, `GATEWAY_CLEARING`, `PROVIDER_FEE`, `PAYOUT_CLEARING`, and `REFUND_CLEARING` are already subject-agnostic by name and definition (none of them say "campaign" in what they mean), so Trip Fee money passes through the exact same accounts on its way to settlement, escrow, and payout — only the final withdrawable balance needs its own named account, for the same reason `CAMPAIGN_BALANCE` itself is named rather than generic: a query against a specific account name must never accidentally mix Campaign and Trip money.
- `Refund` needs **no schema change**. Once `Payment` is polymorphic, a Refund against a Trip Fee Payment works through the exact same `Refund.paymentId` relation a Campaign refund already uses. Only the business rule for the refund amount differs (see below) — that's a service-layer decision, not a schema one.
- No change to `Campaign`, `Donation`, `CampaignStatus`, or any Campaign-only route. ADR 0014's boundary holds: Volunteer Trip is a new entity, not a reworking of Campaign.

### Money-layer generalization

- Every leg-builder in `lib/money/ledger.ts` (`paymentSettledLegs`, `escrowReleaseLegs`, `refundLegs`, `payoutInstructedLegs`) currently takes a required `campaignId: string` and hardcodes `CAMPAIGN_BALANCE`. Each is generalized to take a `subject: { type: 'campaign'; campaignId: string } | { type: 'trip'; tripId: string }` in place of the bare `campaignId`, switching the balance-bearing account (`CAMPAIGN_BALANCE` vs `TRIP_BALANCE`) and the `LedgerEntry` FK it sets accordingly. `ESCROW_HOLD`/`GATEWAY_CLEARING`/`PROVIDER_FEE`/`PAYOUT_CLEARING`/`REFUND_CLEARING` legs still get whichever FK matches the subject (so escrow can be queried per-Trip the same way it's queried per-Campaign today), but the account name itself never changes.
- `postTransaction` itself needs no change — it already just posts whatever legs it's given and asserts they balance; it has never known about Campaign specifically.
- `campaignBalance`/`escrowBalance` (`lib/money/ledger.ts`) gain Trip-scoped siblings — `tripBalance`/`tripEscrowBalance`, or the two existing functions grow a subject parameter the same way the leg-builders do. Either shape is fine; whichever a plan chooses, don't leave two divergent implementations of `accountBalance`'s underlying query.
- `releaseMaturedEscrow` (`lib/money/escrow.ts`) sweeps by `Payment.escrowReleaseAt`/`escrowReleasedAt`, which are Payment-level fields already shared regardless of whether the Payment is Donation- or Registration-linked — the sweep needs to branch only at the point where it decides which subject's legs to post (by checking whether the Payment's `donationId` or `registrationId` is set), not a parallel sweep function.
- `requestPayout`/`approvePayout` (`lib/money/payouts.ts`) are Campaign-specific today, including Campaign-specific error classes (`DemoCampaignError`, `BankAccountNotEligibleError`, etc.) and the `SELECT ... FOR UPDATE` lock on the Campaign row (added after ticket 42's final review found the equivalent lock missing on a different resource). Volunteer Trip payout needs the same two-person rule, the same balance-check-before-approve shape, and the same row-lock discipline — but this spec does not mandate literally reusing these two functions verbatim versus writing a Trip-scoped sibling pair built the same way. That choice belongs to whoever plans this ticket; what's load-bearing is that the *pattern* (lock the balance-bearing row before reading it, two different people, no shortcuts) is not weakened for Trip Payout.
- `POST /api/webhooks/[provider]` (the only place any of this money becomes real, per its own existing comment) generalizes to look up which of `donationId`/`registrationId` is set on the Payment it's settling, call the appropriate notification (`notifyDonationConfirmed` already exists; a new `notifyRegistrationConfirmed` is added), and pass the right `subject` into `paymentSettledLegs`. No second webhook route.

### Trip Fee refund rule (new)

- A new pure function, e.g. `tripFeeRefundAmount(params: { departureDate: Date; now: Date; paidAmount: number })`, computes the tiered-by-time-to-departure refund amount for a Volunteer-initiated cancellation. The exact day-thresholds and percentages are **not decided by this spec** — see Further Notes and PRD §13's open item — but the function's shape (pure, deterministic, unit-testable in isolation) is.
- A Fundraiser-initiated Batch cancellation for missing `minQuota` always refunds every `CONFIRMED` Registration on that Batch in full, regardless of `tripFeeRefundAmount`'s tiered output — this is a different code path with a different, simpler rule (100%, always), not `tripFeeRefundAmount` called with a departure date far in the future.
- Both paths ultimately call `refundLegs`, generalized the same way the other leg-builders are: its `source` parameter grows a `'TRIP_BALANCE'` option alongside the existing `'ESCROW_HOLD' | 'CAMPAIGN_BALANCE'`, and it takes the same `subject` discriminator the settlement legs do.
- ADR 0007's flat Gross-refund rule is untouched and still governs every Campaign refund; this is a new, separate rule for a new, separate entity, exactly as ADR 0014 records.

### Routes

- `POST /api/volunteer-trips` — Fundraiser creates a `DRAFT` Trip. `PATCH /api/volunteer-trips/[slug]` — edit while `DRAFT`/`REJECTED`, or submit (→ `SUBMITTED`).
- `GET /api/volunteer-trips` — public catalog, `ACTIVE` only. `GET /api/volunteer-trips/[slug]` — public detail, includes its open Batches.
- `POST /api/volunteer-trips/[slug]/batches` — Fundraiser adds a Batch to their own Trip. `PATCH /api/volunteer-trips/[slug]/batches/[id]` — edit while `OPEN`, or Fundraiser-initiated cancel.
- `POST /api/volunteer-trips/[slug]/batches/[id]/registrations` — Volunteer registers: sweeps expired holds on this Batch first (see below), checks `maxQuota` against `HOLD + CONFIRMED` count, creates a `HOLD` Registration and a `PENDING` Payment, returns the same provider-checkout shape `POST /api/donations` already returns.
- `GET /api/registrations/mine` — the Volunteer's own Registration history, mirroring the existing `GET /api/donations/mine`.
- `POST /api/moderasi/volunteer-trips/[id]` — Verifier approve/reject with a reason, mirroring `POST /api/moderasi/campaigns/[id]`. A separate queue endpoint (`GET /api/moderasi/volunteer-trips`) rather than folding Trips into the Campaign queue — they're a different entity type, and the CSR spec already established the precedent of a new entity getting its own admin surface rather than being shoehorned into Campaign's.
- `POST /api/volunteer-trips/[slug]/payouts` — Fundraiser requests a Trip Balance payout, mirroring `POST /api/campaigns/[slug]/payouts` including the same escrow-release-at-the-top-of-the-request pattern, generalized per above.

### Registration hold-expiry sweep

- New, modeled directly on `releaseMaturedEscrow`'s existing pattern: a function that finds every `HOLD` Registration on a given Batch whose `holdExpiresAt` has passed and its `Payment` is still `PENDING`, flips the Registration to `EXPIRED`, and lets the Payment expire on its own existing `expiresAt` mechanism (unchanged — `Payment` already has this field and this behavior for Donations). Run at the top of the registration route, the same way escrow release runs at the top of a payout request: no scheduler needed, the sweep only has to run often enough that the next person trying to register benefits from it.

## Testing Decisions

### Seams under test

- **The exported route handler** is the primary seam, matching this repo's established convention (the parent PRD-compliance spec, and the CSR/Hibah spec that followed it): import the route module, invoke its exported `POST`/`PATCH`/`GET` with a mocked `@/lib/prisma`, assert on the HTTP response and what was persisted.
  - New route seams: every route named above under Routes.
- **`lib/money/ledger.ts`'s leg-builder functions and `postTransaction`** — the same seam the parent spec's money-layer tests already use, now exercised with `subject: {type:'trip', ...}` in addition to `subject: {type:'campaign', ...}` (or the pre-existing bare-`campaignId` calls, whichever shape the generalization lands on — the test still calls the exported function directly, not through a route).
- **`releaseMaturedEscrow`** — existing seam (`lib/money/escrow.test.ts`), extended to cover Trip Fee payments.
- **`tripFeeRefundAmount`** — new pure function, tested directly and exhaustively (it's cheap to test every boundary since it takes no I/O).
- **`POST /api/webhooks/[provider]`** — existing seam, extended to cover a Trip Fee Payment settling.

### What makes a good test here

Same standard as the rest of this codebase: assert externally observable behaviour — the HTTP status and body, the rows actually written, the ledger legs actually posted — never that a particular internal function was called. Money-layer tests assert invariants (a Trip Balance can never source a Campaign Payout; every posted transaction's debits equal its credits; `maxQuota` is never exceeded by concurrent registrations) rather than implementation shape.

### Regression tests that must exist

- A `VolunteerTrip`'s Trip Balance can never be the source of a Campaign `Payout`, and a `Campaign`'s Campaign Balance can never be the source of a Volunteer Trip payout, however either is requested — the cross-subject-leakage invariant this generalization makes newly possible to get wrong.
- Two concurrent Registration requests against a Batch at exactly one remaining seat: exactly one succeeds, the other is refused (mirrors the existing concurrency discipline already required elsewhere in this codebase — locking, predicate-based updates — for exactly this class of race).
- A `HOLD` Registration whose hold window has expired does not count against `maxQuota` for a subsequent registration attempt.
- A Batch cancelled for missing `minQuota` refunds every `CONFIRMED` Registration in full, and refuses to also apply the tiered refund rule to any of them.
- A `PATCH /api/admin/users/[id]/role` role change (existing route) still never touches `UserAssignment` — unaffected by this spec, listed here only as a reminder that this spec's schema changes must not be the thing that finally breaks that guarantee if a migration touches shared files.
- No Platform Fee leg is ever posted against a Trip Fee settlement.

### Prior art

`api/campaigns/route.ts`, `api/campaigns/route.test.ts`, `api/moderasi/campaigns/[id]/route.test.ts` for the route-handler seam style this spec's new routes should match. `lib/money/ledger.test.ts` and `lib/money/escrow.test.ts` for the money-layer property-test style and the concurrency-test pattern. `api/webhooks/[provider]/route.test.ts` for how a settlement webhook test is currently shaped.

## Out of Scope

- Adding `volunteer` as a fifth Campaign Kind. Explicitly rejected by ADR 0014; not reopened here.
- Deciding the exact refund-tier day-thresholds, the exact hold-window duration, and the default `minQuota` value. These are real, open numeric parameters — PRD §13 lists them as still open — deferred to spec-to-plan or implementation, not invented here.
- Whether a Fundraiser-cancelled-Batch refund goes through the same multi-Admin approval cycle PRD §7.2 designs for an ordinary Campaign Refund, or a simpler, more automatic path since there's no discretionary judgment involved (a quota threshold either was or wasn't met). Genuinely undecided — see Further Notes.
- Structured, field-by-field itinerary data (day-by-day schedule, named activities). This spec's `itinerary` is free text, matching how `Campaign.description`/`story` are already free text.
- English/i18n for any Volunteer Trip page. Still Fase 3 per the PRD, unaffected by this spec.
- Building `Refund`'s own create/approve/complete API if it doesn't already exist by the time this is implemented. See Further Notes — this spec assumes it exists or lands alongside.
- A Fundraiser adding team members, transferring a Trip to another Fundraiser, or any multi-Fundraiser collaboration on one Trip.
- Waitlisting a Volunteer once a Batch reaches `maxQuota`. A full Batch simply refuses new Registrations; nothing here queues a Volunteer for a seat that opens up.

## Further Notes

**Cross-spec dependency: Refund has no caller yet.** As of this spec, `Refund` exists as a schema model but no route creates, approves, or completes one — PRD §7.2's design exists on paper, ticketed but not built (per this session's own PR notes: "refunds have no caller"). Volunteer-initiated cancellation and Batch-cancellation-refund both need that surface to exist. When this spec is ticketed, either sequence Volunteer Trip's refund-triggering tickets after Refund's own API lands, or land both together — building a Volunteer-Trip-only refund path that diverges from whatever Refund API eventually ships for Campaign would be the wrong outcome, the same caution the CSR spec already raised about Manual Contribution.

**This generalizes shipped, reviewed code, not greenfield code.** Unlike the CSR/Hibah spec (written when `Kind`, `KindAuthorisation`, and even `Manual Contribution` didn't exist yet), `Payment`, `LedgerEntry`, and `Payout` are live, tested, and already carry real money-movement logic through escrow release and reconciliation. The seam-check round of this spec's own grilling confirmed the direction (generalize in place, don't duplicate) explicitly, precisely because that risk is real: whoever plans this should budget review attention for the Campaign-side regression risk specifically, not just for the new Trip-side behavior. `campaignBalance`/`escrowBalance`'s existing tests, and every existing leg-builder test, must still pass unchanged once the subject parameter is introduced.

**Batch-cancellation refund's approval shape is a real open question, not an oversight.** PRD §7.2's Refund cycle (create → two-Admin approve/complete) is designed for a *discretionary* Campaign refund, where a human judgment call is exactly the point. A Batch missing `minQuota` by its registration deadline is a deterministic trigger with no judgment involved — routing it through the identical three-person cycle may be unnecessary friction, or may be exactly the right conservative default for a first cut of a money-moving feature. Flagged here rather than decided, matching how ADR 0013 flagged Hibah's rules as provisional rather than silently picking one.

**The naming choice (Trip, not Program) is deliberate, not a placeholder.** `Program` already names CSR's non-money catalog item. Calling this "Volunteer Program" would put two structurally different entities one word apart in every conversation about either. If a future reader wants to rename it back, they should read [ADR 0014](../../docs/adr/0014-volunteer-trip-stays-separate-entity.md) first.

**Sizing.** This spec touches five new models/enums, generalizes four existing money-layer functions plus the settlement webhook, and adds seven new routes. It is plausibly larger than one `writing-plans` session-sized plan — `/specflow:spec-to-plan` should make that call explicitly rather than this spec presupposing it; if it is, `/specflow:to-tickets` is the next step, not a second pass at this document.
