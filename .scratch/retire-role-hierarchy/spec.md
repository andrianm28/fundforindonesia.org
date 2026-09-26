# Spec: Retire the Role hierarchy and the self-claimed verification

Status: ready-for-agent
Source: grilling of 2026-09-26 on prd-compliance tickets 06–08. It supersedes those tickets, which are closed as superseded. See also PRD FFI-04 and FFI-05, `CONTEXT.md` (Fundraiser, Verifier, Admin, Capacity), and ADR 0005.

## Problem Statement

Admin and Verifier power now come only from assignments. `User.role` is still read and written, though:
- `withRoleCheck('CAMPAIGN_CREATOR')` guards Campaign and Trip creation and both Payout request routes;
- `legacyCampaignCreatorGate` guards the four owner routes;
- the middleware gates `/campaign/create` by rank;
- the create page and the account page check rank;
- the Admin user page still edits Roles, including "Moderator" and "Admin", which grant nothing any more, and still refuses to let an Admin "remove ADMIN from yourself".

CAMPAIGN_CREATOR contradicts PRD FFI-04, under which any registered user may create. It is granted by an Admin without an audit trail. The self-claimed `isVerified` / `verificationType` left over from before C2 is still sent in public payloads (`creator.isVerified`).

## Solution

- **Submitting:** anyone registered may submit a Campaign or Volunteer Trip. The Verifier's approval is the gate. Until Verification Request (ticket 12) exists, the Verifier checks identity outside the system before approving a person's first submission.
- **Payouts:** ownership (the Capacity judgement) plus Campaign status.
- **The Role hierarchy goes:** `withRoleCheck`, `isAtLeast`, `roles.ts`, `ROLE_LEVELS`, the Role editor and the self-demotion check are all removed.
- **Payloads:** the self-claimed verification fields are no longer read or sent.
- **Columns:** `role`, `isVerified` and `verificationType` become nullable and ignored, then are dropped in a separate, human-coordinated deploy. This is the same pattern as the legacy status column.

## User Stories

1. As a registered user, I want to submit a Campaign without asking an Admin for a Role, so that anyone with a real need can start (FFI-04).
2. As a Verifier, I want every public Campaign and Trip to have passed my approval, so that approval, not a Role, decides what is published.
3. As a Fundraiser, I want to request a Payout on my approved Campaign without a separate Role, so that ownership and status are what count.
4. As an Admin, I want the user page to manage only assignments, so that I cannot hand out a Role that looks meaningful but grants nothing.
5. As a Donor, I want no "verified" signal that the Fundraiser claimed themselves, so that I am not misled.
6. As an engineer, I want one authority model (assignments and the Capacity judgement), so that no rank comparison remains anywhere.

## Implementation Decisions

- **Ticket 01, creation and Payout gates:**
  - Remove `withRoleCheck('CAMPAIGN_CREATOR')` from Campaign create, Trip create and both Payout request routes.
  - Remove `legacyCampaignCreatorGate` from the owner routes.
  - Remove the middleware's `/campaign/create` rank gate; login is still required.
  - Remove the create-page and account-page rank checks, and the "Hubungi Admin untuk menjadi Fundraiser" copy.
  - Creation still produces a SUBMITTED Campaign awaiting a Verifier, and a DRAFT Trip that its Fundraiser then submits (volunteer-trip-operations 01).
- **Ticket 02, stop reading and writing `role`, `isVerified` and `verificationType`:**
  - Delete `roles.ts`, `withRoleCheck`, `ROLE_LEVELS`, and the Role route and editor under `/admin/users`, keeping assignments.
  - Drop `role` from the session and JWT and from `next-auth.d.ts`.
  - Stop sending `creator.isVerified` in payloads.
  - The Admin user list shows assignments.
  - Additive migration: the three columns become nullable, with defaults removed.
  - The seed stops writing them.
  - A static guard pins that nothing names them.
- **Ticket 03, drop the columns and the `Role` enum:** ready-for-human, after ticket 02 is live in production.

## Testing Decisions

- **What good tests assert:** who may do what, through routes and the Capacity judgement, never which helper ran.
- **Ticket 01:** a user with no Role and no assignment can create a Campaign (SUBMITTED) and a Trip. The owner can request a Payout on an approved Campaign. A non-owner is still refused.
- **Ticket 02:**
  - The guard shows no `role`, `isVerified` or `verificationType` reference remains in `src`.
  - Payload tests show no `isVerified`.
  - The Admin user page renders assignments only.
  - The migration is verified on a throwaway Postgres, with `migrate diff` empty.

## Out of Scope

- Verification Request and a real, Verifier-recorded identity status (ticket 12).
- Removing the columns in the same deploy that stops using them.

## Further Notes

- Ticket 01 waits for `legacy-status-contract` ticket 02, which is running and edits the Campaign create route.
- prd-compliance tickets 06–08 are closed as superseded by this spec.
