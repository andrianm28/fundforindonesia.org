# Spec: Subject guard, and what Suspension does to money

Status: ready-for-agent
Source: architecture review 2026-09-25, candidate 4, with the grilling decisions that followed. Absorbs the remaining scope of `.scratch/prd-compliance-fase-0-2/issues/30-suspension-cancellation.md`, now closed as superseded. Governing texts: PRD FFI-07, FFI-07b, §7.2, §8; `CONTEXT.md` (Payout, Escrow Hold, Suspension, Cancellation, Admin); ADR 0004, 0005, 0014, 0015.

## Problem Statement

A Suspension is meant to freeze a problem Campaign's money. Today it freezes none of it:
- The Fundraiser of a Suspended Campaign can still request a Payout, and an Admin can still approve it.
- Matured Escrow Hold keeps flowing into Campaign Balance.
- A Campaign that was honestly Cancelled can still pay out whatever is left.

This defeats the reason Suspension reaches Expired and Completed Campaigns at all (ADR 0015). It is the last open "critical" gap from the PRD/ADR analysis.

It stays open because the money modules never ask the Campaign's status:
- Payouts, Refunds and the Escrow release each lock the Campaign or Volunteer Trip row with their own copy of the same SQL, next to a fifth copy in the lifecycle module.
- The lock-ordering rule (subject before Payment) lives only in a comment.
- One of them (Payout approval) reads before it locks.

Every rule that ticket 30 needs would have to be added in three places.

Separately, anyone who opens a Suspended or Cancelled Campaign by direct link sees an ordinary, donatable-looking page. A Fundraiser who withdrew honestly looks no different from one who was frozen.

## Solution

One subject guard module owns "lock the Campaign or Volunteer Trip row, then read it" for every caller: the lifecycle runner, Payouts, Refunds and the Escrow release. It returns the subject's state (owner, demo flag, effective status) and answers "may this subject pay out?" and "is this Admin acting on their own record?".

On top of it:
- A Payout is requested and approved only while the Campaign is Active, Expired or Completed. Suspended and Cancelled refuse it, even when the Suspension lands between request and approval.
- The Escrow release skips Suspended Campaigns and resumes on its own once the Suspension is lifted.
- Refunds stay possible while Suspended (§7.2).
- The older money errors gain codes and one HTTP mapping.
- The Campaign page shows a neutral status banner and hides the donate button for Suspended, Cancelled, Expired and Completed Campaigns. Only the owning Fundraiser sees the Suspension reason.

## User Stories

1. As an Admin, I want a Payout request on a Suspended Campaign refused, so that a frozen Campaign cannot move money out.
2. As an Admin, I want approving a Payout refused when the Campaign was suspended after it was requested, so that a Suspension landing mid-way still holds.
3. As an Admin, I want a Payout request on a Cancelled Campaign refused, so that a withdrawn Campaign's money goes back to Donors rather than to the Fundraiser.
4. As a Fundraiser of an Active, Expired or Completed Campaign, I want Payouts to keep working exactly as today, so that keep-it-all (ADR 0004) still holds.
5. As a Fundraiser, I want a refused Payout to tell me in Indonesian, with a code, that the Campaign's status does not allow it, so that I know why.
6. As an operator, I want matured Escrow Hold on a Suspended Campaign left in Escrow Hold, so that a frozen Campaign's balance does not grow.
7. As an operator, I want that held money released by the next sweep once the Suspension is lifted, so that no manual step is needed.
8. As an Admin, I want Refunds to remain possible on a Suspended Campaign, so that Donors can be repaid while it is frozen (§7.2).
9. As a Volunteer Trip Fundraiser, I want Trip Payouts, Refunds and Escrow release to behave exactly as today, so that Campaign rules do not leak into Trips (ADR 0014).
10. As an engineer, I want the row-lock SQL written once, so that lock order (subject before Payment) is enforced by code, not a comment.
11. As an engineer, I want Payout approval to lock before it reads, like every lifecycle command, so that there is one locking rule.
12. As an engineer, I want the money modules' refusals to carry codes and map to HTTP in one place, so that money routes stop repeating `instanceof` chains.
13. As a Donor opening a Suspended Campaign by link, I want a neutral banner saying it is under review and not accepting donations, and no donate button, so that I do not try to give.
14. As a Donor opening a Cancelled Campaign, I want a banner saying the Fundraiser withdrew it, so that I can tell it apart from a frozen one (PRD §8).
15. As a Donor opening an Expired or Completed Campaign, I want a banner saying it has ended and no donate button, so that the page matches what the server allows.
16. As the owning Fundraiser of a Suspended Campaign, I want to see the Suspension reason on its page, so that I know what to fix (FFI-07b).
17. As anyone other than the owning Fundraiser, I want the Suspension reason withheld, so that an unproven report is not published.

## Implementation Decisions

- **Subject guard module** (in `src/lib`, used by lifecycle and money; not a domain term):
  - `lockAndLoad(tx, subject, now)` takes the row lock on the Campaign or Volunteer Trip, then reads it. It returns `{ kind, id, ownerId, isDemo, effectiveStatus }`. For a Trip, `isDemo` is false and the status is the Trip's own status.
  - Pre-guard checks may still run before `lockAndLoad`, but no caller reads the subject row before it.
  - `requirePayoutAllowed(state)` passes only for a Campaign whose effective status is ACTIVE, EXPIRED or COMPLETED. For a Trip it applies today's rule unchanged.
  - `requireNotOwnerAsAdmin(state, actor)` raises the existing own-Campaign or own-Trip conflict error.
  - It is the only place in `src` that issues `SELECT … FOR UPDATE` on the Campaign or VolunteerTrip tables. A static guard test pins this.
- **Users of the guard**, with lock order subject first, then Payment, wherever both are locked:
  - the lifecycle runner's lock-then-read;
  - `requestPayout` and `approvePayout` (the latter now locks before reading);
  - `createRefund` and `approveRefund`;
  - `releaseMaturedEscrow`.
- **Suspension effects:**
  - `requestPayout` and `approvePayout` call `requirePayoutAllowed` inside the lock.
  - `releaseMaturedEscrow` skips Payments whose Campaign is effectively SUSPENDED, leaving them in Escrow Hold. They are picked up by the first sweep after a lift.
  - Refund functions do not call `requirePayoutAllowed`.
- **Errors:**
  - New refusals are typed, with a code (for example `PAYOUT_NOT_ALLOWED_FOR_STATUS`) and an Indonesian message, mapped through the same error-to-HTTP function as the lifecycle module (409).
  - Existing money errors (demo Campaign, bank account not eligible, insufficient balance, self-approval, invalid Payout/Refund status, not found) gain codes and Indonesian messages and map through that one function.
  - The money routes lose their `instanceof` chains.
  - The duplicate self-approval error class is merged.
  - Error classes stay, so callers catching them keep working.
- **Campaign page:**
  - The public Campaign payload exposes `lifecycleStatus`.
  - The page shows a status banner and hides the donate action unless the Campaign is effectively Active.
  - Banner copy:
    - Suspended: "Campaign ini sedang ditinjau dan tidak menerima donasi."
    - Cancelled: "Fundraiser telah menarik Campaign ini."
    - Expired or Completed: "Campaign ini telah berakhir."
  - The Suspension reason (latest SUSPENDED status-change row) is returned only to the owning Fundraiser, and shown to them under the banner.
- **Out of the guard:** the Settlement webhook keeps its own Payment-first idempotency flow. Money arriving after Suspension or Cancellation goes to the Refund queue, which is ticket 32.

## Testing Decisions

- **What a good test is:** it asserts behaviour through each module's interface. That means returned results, typed errors with codes, and ledger/database effects, never which helper ran.
- **Guard ticket (refactor, no behaviour change):**
  - Existing Payout, Refund, Escrow and lifecycle tests stay green. Edits are allowed only where a test asserted the raw lock SQL shape.
  - A new static guard test fails if any other `src` file locks Campaign or VolunteerTrip rows.
  - The guard itself is tested for both subject kinds, not-found, and effective status.
  - Prior art: the in-memory stand-ins in the money tests, and the lifecycle cross-cutting test.
- **Suspension-effects ticket:**
  - A table test over Campaign effective statuses for request and approve.
  - Suspension landing between request and approval is modelled as committed before the lock.
  - Escrow sweep: a Suspended Campaign keeps its money in hold, it is released after a lift, and Trips are unaffected.
  - Refund on a Suspended Campaign still works.
- **Errors ticket:**
  - Each money route maps every money error code through the one function.
  - Route tests assert codes, not English strings.
- **UI ticket:**
  - Component tests for each banner and for the donate action being hidden.
  - An API test that the reason is returned only to the owner.
  - Prior art: `CampaignDetail*.test.tsx` and the existing `/api/campaigns/[slug]` route test.

## Out of Scope

- The catalogue, sitemap and Urgent-rail readers (architecture candidate 3).
- Refunds triggered by Suspension or Cancellation, and the post-closure Refund queue (ticket 32).
- zakat/wakaf transfer on Suspension (ticket 33).
- The "mark Payout Completed" endpoint (ticket 27). It must call `requirePayoutAllowed` when built; a note is recorded there.
- Narrowing the persistence seam (candidate 5).
- Campaign DELETE (C11).

## Further Notes

- Order: tickets 01 (guard) and 04 (UI) can run in parallel. Then 02 (Suspension effects). Then 03 (errors), because it touches the same money files as 02.
- `CONTEXT.md` already records the Payout and Escrow Hold rules (commit `8e42a9c`).
