# Spec: Close the last operator-rule gaps (C11 and Trip moderation)

Status: ready-for-agent
Source: grilling of 2026-09-25 on gap C11 and on Volunteer Trip moderation. `CONTEXT.md` (Campaign, Verifier); ADR 0005, 0014, 0016.

## Problem Statement

- **Campaigns can be deleted.** `DELETE /api/campaigns/[slug]` still lets a Campaign's owner (by the legacy Role hierarchy) or anyone with the legacy ADMIN role delete a Campaign that has no status history, Flag, Cancellation request or Payment, and its pending Donations are deleted with it. PRD and CONTEXT.md know only Cancellation (approved by an Admin) and Suspension. ADR 0016 now says Campaigns are never deleted. The Admin panel's delete button always gets a 404 anyway.
- **A Verifier can moderate their own Volunteer Trip.** The Trip moderation route checks only the VERIFIER assignment, so a Verifier who is a Trip's Fundraiser can approve or reject it. CONTEXT.md now says a Verifier never acts as Verifier on a Campaign or Volunteer Trip they own.

## Solution

- Remove the Campaign DELETE endpoint and the Admin delete button, along with the helper that mapped lifecycle foreign-key restrictions to 409, which only DELETE used.
- The Trip moderation route refuses a Verifier who owns the Trip, with 403 `OWN_TRIP_CONFLICT` and a message worded for the Verifier capacity.

## User Stories

1. As a Donor, I want a Campaign I gave to never to vanish, so that my Donation's history stays intact.
2. As a Fundraiser who wants to withdraw, I want Cancellation to be the one path, so that withdrawal is reviewed and recorded (PRD §8).
3. As an Admin, I want no delete button that pretends to work, so that the panel only offers real actions.
4. As a Verifier who is also a Volunteer Trip's Fundraiser, I want to be refused when I try to moderate my own Trip, so that another Verifier judges it (ADR 0005).
5. As a Verifier, I want the refusal worded for the Verifier capacity, so that I know another Verifier must act.

## Implementation Decisions

- **DELETE removal:**
  - `DELETE` is removed from the Campaign `[slug]` route. A request with that method gets the framework's 405.
  - `DeleteCampaignButton` and its use in the Admin Campaigns page are removed.
  - `isLifecycleRecordRestrict`, and its tests, go.
- **Trip moderation:** the route compares the Trip's `fundraiserId` with the acting Verifier. It raises the existing `OwnTripConflictError`, extended to take a capacity the way `OwnCampaignConflictError` does, so the Verifier wording differs from the Admin one. It maps through `domainErrorToHttp`.
- **Guards:** update the static guards that listed the removed files.

## Testing Decisions

- **Campaign route test:** `DELETE` is gone. There is no exported DELETE handler, which a test asserts.
- **Admin page:** its test asserts no delete control is rendered.
- **Trip moderation route:**
  - owner-Verifier gets 403 `OWN_TRIP_CONFLICT` with the Verifier wording, and the Trip is unchanged;
  - a non-owner Verifier still approves and rejects as before.
- **Prior art:** the Campaign moderation own-Campaign tests (C20 ticket 09).

## Out of Scope

- Withdrawing an unreviewed submission; that belongs to Verification Request, ticket 12.
- Deleting demo data. That is done by an operator in the database (ADR 0016).
