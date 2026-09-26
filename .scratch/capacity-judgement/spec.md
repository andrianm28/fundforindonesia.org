# Spec: One Capacity judgement

Status: ready-for-agent
Source: architecture review of 2026-09-26, candidate 1, and the grilling that followed. `CONTEXT.md` (Capacity, Admin, Verifier, Fundraiser, Volunteer Trip); ADR 0005, 0014.

## Problem Statement

CONTEXT.md states one rule: a person acts in exactly one Capacity per action, and on a Campaign or Volunteer Trip they own they act only as its Fundraiser. The code enforces that rule four different ways:
- the lifecycle runner's authority step, with its own owner-becomes-Fundraiser fallback;
- `requireNotOwnerAsAdmin` in the subject guard, which is Admin-only and treats a Trip differently on Refund create than on Refund approve;
- an inline check in the Trip moderation route;
- nothing at all on Payout approval, which relies on "approver ≠ requester".

Two error classes carry the same message template, with different default capacities, in two different error families. About nine routes hand-write "only the owner may…" with nine different 403 texts. And several places still grant Admin power from the legacy Role (`role === 'ADMIN'`, `isAtLeast`, the admin pages, the `/admin` middleware gate), which ADR 0005 replaced with the ADMIN assignment.

## Solution

One pure Capacity judgement module answers a single question: *may this actor act in this Capacity on this subject?* It takes the subject (kind and owner), the actor (id and assignments) and the requested Capacity, and returns the effective Capacity or one typed refusal.
- The lifecycle runner, the money operations, the Trip moderation route and the owner-only routes all ask it.
- One error class covers acting on your own record; its two codes stay as they are for API clients.
- Everything that grants Admin from the legacy Role moves to the ADMIN assignment.
- The legacy CAMPAIGN_CREATOR checks stay until the question of who may create a Campaign is decided (prd-compliance tickets 06–08, Verification Request).

## User Stories

1. As an Admin who is also a Campaign's Fundraiser, I want every Admin action on that Campaign refused the same way, whichever screen I use, so that the rule is predictable.
2. As a Verifier who owns a Volunteer Trip, I want the same refusal shape as on my own Campaign, so that the rule reads the same for both subjects.
3. As an Admin, I want Payout approval to refuse me on my own Campaign explicitly, so that the rule doesn't depend on who happened to request it.
4. As a Fundraiser, I want every "only the owner can do this" refusal to have one code and an Indonesian message, so that the UI can explain it consistently.
5. As an operator, I want Admin power to come only from the ADMIN assignment, so that someone with the old Role but no assignment cannot act as Admin (ADR 0005).
6. As an engineer, I want the own-record rule in one pure module tested as a table, so that a change to it is made and proven in one place.
7. As an API client, I want the codes `OWN_CAMPAIGN_CONFLICT` and `OWN_TRIP_CONFLICT` unchanged, so that nothing I built breaks.

## Implementation Decisions

- **Capacity judgement module** (new, in `src/lib`, pure, no database access):
  - Input: a subject `{ kind: 'campaign' | 'trip', ownerId }`, an actor `{ userId, assignments }`, and a requested Capacity.
  - Requested ADMIN or VERIFIER:
    - the matching assignment is required, otherwise `NotAuthorizedError`;
    - the owner is refused with the own-record conflict.
  - Requested FUNDRAISER: the actor must be the owner, otherwise `NotAuthorizedError`.
  - A "Fundraiser or Admin" request (completing a Campaign) returns FUNDRAISER for the owner even if they hold ADMIN, and ADMIN for a non-owner holding ADMIN. That preserves today's behaviour.
  - SYSTEM is never requested by a person.
  - Callers load the subject under the subject guard's lock first, then ask.
- **One error class for acting on your own record:**
  - It replaces `OwnCampaignConflictError` and `OwnTripConflictError`.
  - It is parameterised by subject kind and Capacity, with one Indonesian message template ("…atas {Campaign|Volunteer Trip} milik Anda sendiri. Tindakan ini harus dilakukan {Admin|Verifier} lain.").
  - Its codes stay `OWN_CAMPAIGN_CONFLICT` and `OWN_TRIP_CONFLICT`, both in one error family.
  - The old class names may remain as aliases if that keeps call sites simple; the report must say which option was taken.
- **Callers moved to the judgement:**
  - the lifecycle runner's authority step;
  - `requireNotOwnerAsAdmin`, which becomes a thin call to the judgement or is removed;
  - the Trip moderation route's inline check;
  - `approvePayout`, which gains the check under its lock;
  - the owner-only routes: Campaign PATCH, Campaign Updates, Campaign and Trip Payout request, Trip PATCH, Batch create and Batch actions.
- **Legacy Admin by Role moves to the ADMIN assignment:**
  - Campaign PATCH;
  - the Trip, Batch and Batch-action routes;
  - `admin/layout.tsx` and `admin/page.tsx`;
  - the middleware gate for `/admin`.

  The middleware reads assignments from the session token the same way `/moderasi` pages already do. `withRoleCheck('CAMPAIGN_CREATOR')` and the `/moderasi` Role gate in the middleware are left for tickets 06–08, with a comment pointing there.
- **Behaviour:** unchanged except for three things:
  - uniform codes and messages on the owner-only refusals;
  - the explicit Payout-approval check;
  - Admin power coming from the assignment rather than the Role.

  Each is listed in the ticket and tested.

## Testing Decisions

- **The judgement:** one table test over subject kind (2) × requested Capacity (ADMIN, VERIFIER, FUNDRAISER, Fundraiser-or-Admin) × owner or not × assignment held or not. It asserts the returned Capacity or the exact error class and code. No stand-in is needed, because the module is pure.
- **Callers:**
  - The existing lifecycle, Refund, Trip moderation and Payout tests stay green.
  - Owner-only route tests assert the new uniform code.
  - Payout approval gains an own-Campaign refusal test.
  - Admin pages and middleware get tests for an assignment-holder without the Role (allowed) and a Role-holder without the assignment (refused).
- **Guards:** the roles-expand guard is updated so it asserts no Admin grant via `role === 'ADMIN'` or `isAtLeast(…, 'ADMIN')` remains.

## Out of Scope

- Removing CAMPAIGN_CREATOR and the rest of the Role hierarchy (tickets 06–08).
- The Volunteer Trip operations module (architecture candidate 2).
- The generalised domain-route adapter (candidate 4).
- The persistence seam (candidate 5).

## Further Notes

Order:
1. Ticket 01, the judgement plus its core callers.
2. Ticket 02, the owner-only routes.
3. Ticket 03, Admin by assignment.

Tickets 02 and 03 touch the same route files, so 03 follows 02.
