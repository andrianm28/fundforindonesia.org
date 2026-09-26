# Spec: Volunteer Trip operations module

Status: ready-for-agent
Source: architecture review of 2026-09-26, candidate 2, and the grilling that followed. See also `CONTEXT.md` (Volunteer Trip, Volunteer Batch, Registration, Trip Fee, Capacity, Verifier), ADR 0007, ADR 0014, and PRD FFI-11.

## Problem Statement

Volunteer Trip, Batch and Registration have no domain module. Their rules live in route handlers:
- **Trip submit** checks the status on a read made outside any transaction.
- **Trip moderation** is now predicated on SUBMITTED (campaign-rule-bugs 03), but nothing records who decided, in which Capacity, and when.
- **Registration status** is written in five places: the webhook (twice), Volunteer cancel, Batch cancel, and the expiry sweep.
- **The three Trip Fee Refund rules** from CONTEXT.md live in three routes: tiered on Volunteer cancel, full on Batch cancel, and full automatically on a late settlement.
- **Batch cancel** locks Batch → Registration → Trip → Payment, which conflicts with the subject guard's "subject before Payment" rule.
- **Refusals** use local error classes that each route maps to HTTP by hand.

## Solution

One Volunteer Trip operations module owns every Trip, Batch and Registration transition and the Trip Fee Refund policy, kept separate from Campaign per ADR 0014. It follows the same discipline as the Campaign lifecycle runner:
- lock, then read;
- predicated transitions;
- typed refusals mapped through `domainErrorToHttp`;
- authority from the Capacity judgement.

It does not generalise the Campaign runner.

Supporting changes:
- **Log:** a Trip status-change log records Trip-level transitions (submit, moderation) with actor, Capacity, reason and time.
- **Lock order:** one order for every Trip operation: Trip (through the subject guard) → Batch → Registration → Payment.
- **Refunds:** one Trip Fee Refund policy decides the amount and reason for all three cases.
- **Callers:** routes, the webhook and the expiry sweep become thin callers.

## User Stories

1. As a Verifier, I want every Trip decision recorded with who, in which Capacity, and when, so that the audit trail matches Campaign moderation (ADR 0005).
2. As a Trip Fundraiser, I want submitting my Trip to be judged on its current status under a lock, so that two submits or a submit racing a decision produce one outcome.
3. As a Volunteer who cancels, I want the tiered Refund computed in one place, so that the rule is the same whatever screen I use.
4. As a Volunteer whose Batch is cancelled, I want a full Refund, always, so that the Fundraiser's decision never costs me (CONTEXT.md, Trip Fee).
5. As a Volunteer whose payment settled after my Registration was already cancelled, I want an automatic full Refund, so that I never pay for a seat I don't hold.
6. As an operator, I want one lock order for all Trip money paths, so that concurrent cancels and settlements cannot deadlock or double-refund.
7. As an engineer, I want Trip rules in one module with typed refusals, so that routes, the webhook and the sweep stay thin.

## Implementation Decisions

- **Module:** new, under `src/lib/volunteer/`. Operations:
  - `submitTrip` and `decideTripSubmission`;
  - `createBatch`, `editBatch`, `cancelBatch` and `completeBatch`;
  - `holdRegistration`, `confirmRegistration` (called from Settlement), `cancelRegistration` and `expireRegistrationHolds`.
- **Authority:** each operation asks `judgeCapacity` with the Trip as subject: FUNDRAISER for owner actions, VERIFIER for moderation. The Volunteer's own Registration cancel is checked against the Registration's Volunteer.
- **Log:** a Trip status-change log, added by an additive migration. It records action, from and to (VolunteerTripStatus), actor, Capacity, reason and time. Trip submit and moderation write it. Batch and Registration get no log; their money trail is in the ledger and Refunds.
- **Trip Fee Refund policy:** one function takes the Registration, the case (volunteer cancel, batch cancel, late settlement) and `now`, and returns the amount and reason. The tiered case uses the existing pure `tripFeeRefundAmount`. `createRefund` is called with those values.
- **Lock order:** Trip (subject guard `lockAndLoad`) → Batch → Registration → Payment, documented in one place in the module. Batch cancel is reordered to match.
- **Refusals:** typed, in the Trip error family (`volunteer-trip-errors.ts`, which already holds `TRIP_NOT_SUBMITTED`), mapped through `domainErrorToHttp`. Local error classes go.
- **Out of scope:** new Trip transitions (SUSPENDED, CANCELLED and COMPLETED for a Trip), which the PRD does not define yet.

## Testing Decisions

- **Good tests** assert outcomes through the module's interface (states, log rows, Refund amounts, typed errors), not which helper ran.
- **Module tests:**
  - every operation's allowed and refused statuses;
  - the Capacity refusals;
  - the Trip log rows;
  - the three Refund cases (tiered boundaries, full on Batch cancel, full on late settlement);
  - concurrency modelled as "committed before our lock".
- **Stand-in:** a small in-memory stand-in for Trip, Batch, Registration and Payment, or an extension of the existing one.
- **Route, webhook and sweep tests:** shrink to "calls the right operation, maps the result".

## Out of Scope

- New Trip transitions (see above).
- Generalising the Campaign runner.
- The persistence seam (architecture candidate 5).
- Trip Suspension.

## Further Notes

Order: 01 (module, submit and moderation, log) → 02 (Batch operations and lock order) → 03 (Registration operations and the Refund policy, including the webhook and sweep).
