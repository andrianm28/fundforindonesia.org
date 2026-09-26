# Spec: Verification Request, first slice

Status: ready-for-agent
Source: grilling of 2026-09-26 on prd-compliance ticket 12. See PRD FFI-04, FFI-05 and §7.1; `CONTEXT.md` (Verification Request, Identity Verification, Campaign Status, Verifier, Capacity); ADR 0005, ADR 0012. This spec supersedes the first-slice parts of ticket 12. Ticket 12 stays open for re-verification of changes to Active Campaigns and for per-Kind checklists.

## Problem Statement

Today, creating a Campaign submits it at once. A Verifier approves or rejects with one click: there is no checklist, and a rejection carries no reason. Resubmitting overwrites nothing because nothing is kept; the only trace is a status-change row. A Fundraiser cannot save a Draft, cannot withdraw a submission they regret, and never learns why they were refused. Identity checks happen outside the system and leave no record. The self-claimed `isVerified` flag, now being removed, was the only "verified" signal.

## Solution

- A Campaign is created as a **Draft**. The Fundraiser edits it and then submits it.
- Each submission creates a **Verification Request**. It holds a checklist snapshot, taken from an Admin-configured list and seeded with PRD §7.1's "all Kinds" row. It also holds the outcome, the reason, the actor and the time.
- The Verifier ticks the checklist and approves, or rejects with a required reason.
  - A rejected Campaign becomes **Rejected**. It stays editable and can be resubmitted without limit, and each resubmission is a new Verification Request.
  - Approving a Fundraiser's **first** request records an **Identity Verification** for them.
- The Fundraiser may **withdraw** an undecided request: a first submission goes back to Draft, a resubmission back to Rejected.
- The Fundraiser is notified in-app with the reason. Email comes later (ticket 13).
- The Verifier queue becomes a queue of open Verification Requests.

## User Stories

1. As a Fundraiser, I want to save my Campaign as a Draft, so that I can finish it before a Verifier sees it.
2. As a Fundraiser, I want to submit my Draft to a Verifier when it is ready, so that review starts only when I say so.
3. As a Fundraiser, I want to know which documents the checklist expects, so that I am not refused for something I could have supplied.
4. As a Fundraiser, I want to withdraw my submission while it is undecided, so that I can fix a mistake before anyone spends time on it.
5. As a Fundraiser, I want the reason for a rejection, so that I know what to change.
6. As a Fundraiser, I want to edit and resubmit a Rejected Campaign as often as needed, so that one refusal is not the end.
7. As a Verifier, I want a queue of open Verification Requests, so that I know what is waiting.
8. As a Verifier, I want the same checklist every time, so that I check the same things for every Campaign.
9. As a Verifier, I want to be unable to reject without a reason, so that every refusal is explained.
10. As a Verifier, I want my first approval of a Fundraiser to record their Identity Verification, so that later submissions do not repeat the check.
11. As an Admin, I want to edit the checklist items from the panel, so that document rules change without a deploy (PRD §7.1).
12. As anyone auditing, I want every request's checklist, outcome, reason, actor and time kept forever, so that the history of refusals survives.
13. As a Donor, I want Drafts and Rejected Campaigns never to appear publicly, so that I only see approved appeals.

## Implementation Decisions

- **Schema** (additive migration):
  - `VerificationRequest`: `id`, `campaignId`, `submittedById`, `submittedAt`, `checklist` (a JSON snapshot of the items and their ticks), `outcome` (PENDING, APPROVED, REJECTED, WITHDRAWN), `reason`, `decidedById`, `decidedAt`, and `isFirst` (whether this is the Campaign's first request).
  - `IdentityVerification`: `userId` (unique), `verifierId`, `verifiedAt`, `note`.
  - `VerificationChecklistItem`: `id`, `label`, `required`, `position`, `active`. It is Admin-configured and seeded with PRD §7.1's "Semua" items. A `kind` column is left for ticket 09.
  - All foreign keys are RESTRICT, and nothing is deleted.
- **Lifecycle module:** new commands through the runner:
  - `submitCampaign` (FUNDRAISER, from DRAFT or REJECTED to SUBMITTED; creates the request with a checklist snapshot);
  - `decideVerificationRequest` (VERIFIER, not own; approve moves SUBMITTED to ACTIVE, reject moves it to REJECTED with a required reason; creates Identity Verification on the first approval);
  - `withdrawVerificationRequest` (FUNDRAISER; SUBMITTED goes back to DRAFT or REJECTED).

  Each transition is logged in the Campaign status-change log. `decideSubmission` is replaced by `decideVerificationRequest`, and the moderation route and UI call it.
- **Creation:** `POST /api/campaigns` creates DRAFT. The create page offers "Simpan Draft" and "Ajukan ke Verifier". Editing content fields (PATCH) is allowed in DRAFT, REJECTED and ACTIVE, and refused in SUBMITTED and in the final statuses (ticket 05). Changes to target, deadline and Bank Account on an Active Campaign need a new Verification Request, which is a later slice. Unapproved Campaigns (DRAFT, SUBMITTED, REJECTED) are visible only to their Fundraiser, Verifiers and Admins (ticket 06).
- **Queue:** the Verifier queue and count read PENDING Verification Requests. The moderation page shows the checklist with ticks and a reason field.
- **Notifications:** in-app to the Fundraiser on reject (with reason), approve and withdraw confirmation. Email is a dependency on ticket 13.
- **Not in this slice:**
  - document upload (a separate ticket, needing secure storage and ADR 0012 encryption);
  - per-Kind checklists (ticket 09);
  - re-verification of target, deadline or Bank Account changes on Active Campaigns (ticket 12, later);
  - identity for Partner Organisations (which do not exist yet).

## Testing Decisions

- **Good tests** assert outcomes through the lifecycle commands and routes: statuses, request rows, Identity Verification rows, typed refusals and notifications.
- **Module tests:**
  - submit from DRAFT and REJECTED only;
  - decide from PENDING only, with reject requiring a reason;
  - an owner-Verifier is refused;
  - the first approval creates Identity Verification and later ones don't;
  - withdraw sends a first submission to DRAFT and a resubmission to REJECTED;
  - history rows are never updated after being decided;
  - concurrency is modelled as "committed before our lock".
- **Routes and pages:** the create page has two actions, the queue lists PENDING requests only, and the moderation page renders the checklist.
- **Guard:** no route writes the Campaign status except through the lifecycle module (already pinned).
- **Migration:** verified on a throwaway Postgres, with `migrate diff` empty.

## Out of Scope

See "Not in this slice" above. Also out: the Draft auto-save UX, and editing money fields.

## Further Notes

Order:
1. Ticket 01 (schema, Draft creation, submit and queue). It waits for `retire-role-hierarchy` ticket 02, which edits the Campaign create route.
2. Ticket 02 (decide, checklist and Identity Verification) and ticket 04 (Admin checklist editor), in parallel after 01.
3. Ticket 03 (withdraw) after 02.
