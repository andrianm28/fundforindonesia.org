# Spec: Campaign status transitions (gap C20)

Status: ready-for-agent
Source: `.scratch/prd-adr-gap-analysis/research.md` gap C20; PRD `docs/PRD-fund-for-indonesia.md` §7.2, §8, §9, FFI-03, FFI-04, FFI-07b; `CONTEXT.md` (Campaign Status, Suspension, Flag, Cancellation, Urgent, Admin, Verifier); ADR 0004, ADR 0005, ADR 0015.

## Problem Statement

Once the C1 fix restricted the campaign PATCH to Fundraiser content fields, nobody could move a Campaign's status any more except the Verifier moderation endpoint and the Settlement webhook. The pending (uncommitted) webhook fix removes the webhook's auto-complete, because it violated ADR 0004. Together these leave the platform with:

- **No legitimate way to Completed.** A Fundraiser whose work is done, including a `wakaf` Campaign with no deadline whose only ending is Completed, cannot close their Campaign, and neither can an Admin. ADR 0004 and PRD §8 say only the Fundraiser or an Admin marks a Campaign Completed, and only after at least one Campaign Update.
- **Suspension in the wrong hands.** A Verifier suspends directly, with no reason recorded, while an Admin without the VERIFIER assignment cannot suspend at all. The moderation endpoint's `approve` also accepts any status, so a Verifier can quietly bring a Suspended or Completed Campaign back to Active. FFI-07b says the Verifier reports, an Admin decides, and a *different* Admin lifts.
- **No Cancellation path.** A Fundraiser who wants to withdraw honestly has no way to ask. The legacy status string cannot even express `cancelled`.
- **An orphan Urgent flag.** `isUrgent` drives the homepage "mendesak" rail and the `?urgent` filter, but nothing in the application writes it, and nothing takes it down when a Campaign stops being Active.
- **No audit.** PRD §9 requires every Suspension to be recorded with actor and time. Today no status change leaves a trace.

## Solution

Every status change of a Campaign goes through one domain module that knows the legal transitions, who may perform each one and in what capacity, and what must happen alongside it. Each change is written to an append-only status-change log in the same transaction. Thin, per-action HTTP endpoints expose it:

- A Fundraiser marks their own Active Campaign Completed once it has at least one Campaign Update. An Admin can do the same for a Campaign they do not own, giving a reason.
- A Verifier raises a Flag on a Campaign, with a reason. An Admin suspends a Campaign that is Active, Expired or Completed (ADR 0015), normally on a Flag but without one if a reason is given. Open Flags are resolved by the Suspension. An Admin can dismiss a Flag with a reason.
- A *different* Admin lifts a Suspension, with a reason. The Campaign returns to the status it had before, except that a Campaign that was Active and whose deadline has since passed becomes Expired.
- A Fundraiser requests Cancellation of their Active Campaign. The Campaign keeps accepting Donations until an Admin approves or rejects the request. Approval is possible only while no Payout has Completed. A pending request lapses if the Campaign leaves Active first.
- An Admin sets or clears Urgent on an Active Campaign, with a reason. Urgent drops automatically whenever the Campaign leaves Active.
- The Verifier moderation endpoint only approves or rejects Submitted Campaigns. It can no longer suspend.
- No Admin ever acts as Admin on a Campaign they own. On their own Campaign they are only its Fundraiser.
- The Fundraiser is notified in-app of every change they did not make themselves, with the reason.

## User Stories

1. As a Fundraiser, I want to mark my Active Campaign Completed, so that it stops taking Donations once its purpose is met.
2. As a Fundraiser, I want to be told that I need at least one Campaign Update before I can mark my Campaign Completed, so that I know exactly what is missing.
3. As a Fundraiser of a `wakaf` Campaign without a deadline, I want to mark it Completed, so that it has an ending at all.
4. As a Fundraiser, I want reaching my target not to close my Campaign by itself, so that I decide when the work is done (ADR 0004).
5. As a Fundraiser, I want to be refused when I try to complete a Campaign whose deadline has already passed, so that the record says Expired rather than a Completed I did not earn in time.
6. As a Fundraiser, I want Completed to be final, so that Donors can trust a closed Campaign stays closed.
7. As an Admin, I want to mark another person's Active Campaign Completed with a reason, so that a Campaign whose work is done can be closed even when its Fundraiser does not act.
8. As an Admin, I want completing a Campaign to require a Campaign Update even when I do it, so that no Campaign closes without its Donors having heard from the Fundraiser.
9. As a Verifier, I want to raise a Flag on a Campaign with a reason, so that an Admin can decide on Suspension.
10. As a Verifier, I want to raise a Flag on a Campaign that is already Expired or Completed, so that fraud discovered after the Campaign closed still reaches an Admin.
11. As a Verifier, I want several Flags on the same Campaign to be kept separately, so that each report and its author remains visible.
12. As a Verifier, I want to no longer be able to suspend a Campaign myself, so that my role and the Admin's stay separate as ADR 0005 requires.
13. As an Admin, I want to suspend a Campaign that is Active, Expired or Completed with a reason, so that a problem Campaign cannot keep collecting or pay out what it holds.
14. As an Admin, I want to suspend a Campaign that has no Flag when I give a reason, so that an obvious abuse at night does not wait for a Verifier.
15. As an Admin, I want the open Flags on a Campaign to be resolved by my Suspension, so that the Flag queue shows only what is still undecided.
16. As an Admin, I want to dismiss a Flag with a reason, so that a report that does not justify Suspension is closed on the record.
17. As an Admin, I want suspending an already Suspended Campaign to be refused, so that the log shows one Suspension, not duplicates.
18. As an Admin, I want to lift a Suspension that a different Admin imposed, with a reason, so that every Suspension passes two pairs of hands before it ends.
19. As an Admin, I want to be refused when I try to lift my own Suspension, so that the two-person rule cannot be bypassed.
20. As an Admin, I want a lifted Campaign to return to the status it had before Suspension, so that a Completed Campaign does not come back to life and an Expired one does not reopen.
21. As an Admin, I want a Campaign that was Active when suspended, and whose deadline passed during the Suspension, to become Expired when lifted, so that it never accepts a Donation after its deadline.
22. As an Admin working at an operator with a single Admin, I want a clear message that another Admin must lift the Suspension, so that I understand why I am refused.
23. As a Fundraiser, I want to request Cancellation of my Active Campaign with a reason, so that I can withdraw honestly and not look Suspended.
24. As a Fundraiser, I want my Campaign to keep accepting Donations while my Cancellation request waits, so that I cannot freeze my own Campaign without an Admin.
25. As a Fundraiser, I want to be refused a second Cancellation request while one is pending, so that there is only ever one decision to make.
26. As an Admin, I want to approve a Cancellation request with a reason, so that the Campaign becomes Cancelled.
27. As an Admin, I want approval to be refused once a Payout on the Campaign has Completed, so that Cancellation stays limited to Campaigns whose money has not left.
28. As an Admin, I want to reject a Cancellation request with a reason, so that the Fundraiser knows why.
29. As a Fundraiser, I want a pending Cancellation request to lapse when my Campaign leaves Active before a decision (Suspension, expiry, completion), so that an old request is never approved later out of context.
30. As an Admin, I want to set Urgent on an Active Campaign with a reason, so that it is highlighted as urgent on the homepage and in exploration.
31. As an Admin, I want to clear Urgent with a reason, so that the highlight ends when it is no longer true.
32. As a Donor, I want a Campaign that is no longer Active never to show as urgent, even after its Suspension is lifted, so that the urgent rail only shows appeals I can actually give to.
33. As a Fundraiser, I want to be unable to set Urgent on my own Campaign, so that the urgent label stays an operator's judgement rather than self-promotion.
34. As an Admin who is also the Fundraiser of a Campaign, I want to be refused every Admin action on that Campaign, so that I cannot suspend, lift, dismiss Flags, set Urgent or decide Cancellation for myself.
35. As an Admin who is also the Fundraiser of a Campaign, I want completing my own Campaign to be treated as a Fundraiser action, so that the normal Fundraiser rules apply to me.
36. As a Verifier, I want to approve or reject only Campaigns that are Submitted, so that moderation cannot reopen a Suspended, Completed or Cancelled Campaign.
37. As a Fundraiser, I want an in-app notification when my Campaign is suspended, with the reason, so that I know what happened and why (FFI-07b).
38. As a Fundraiser, I want an in-app notification when the Suspension is lifted, when an Admin completes my Campaign, and when my Cancellation request is decided, each with the reason, so that nothing changes behind my back.
39. As a Fundraiser, I want notifications about my Campaign to avoid the word "moderator", so that the language matches the roles the platform actually has.
40. As an Admin, I want every status change, including Urgent changes and automatic ones, recorded with who acted, in what capacity, why and when, so that the audit trail required by PRD §9 exists.
41. As an Admin, I want to see from the record whether a person acted as Fundraiser, Verifier or Admin, so that holding two assignments never blurs who did what (ADR 0005).
42. As an Admin, I want two Admins acting on the same Campaign at the same moment to produce exactly one change, so that a double click or a race never produces two transitions.
43. As an Admin, I want an Active Campaign whose deadline has passed to be recorded as Expired the moment anyone tries to act on it, and that recording to persist even when the action itself is refused, so that the stored status catches up with reality before the nightly job exists.
44. As a Fundraiser, I want every refused action to tell me the reason in plain words (wrong status, missing Campaign Update, not my Campaign, needs another Admin, Payout already completed), so that I know what to do next.
45. As an engineer, I want every status writer to go through one module, so that the legal transitions live in one place and the dual-write guard still sees every writer.

## Implementation Decisions

### One lifecycle module

- The existing Campaign lifecycle module (today the home of the legacy-string mapping and the "only Active accepts a Donation" gate) grows into the single owner of status transitions. No route writes `status`, `lifecycleStatus` or `isUrgent` directly.
- **`effectiveStatus(campaign, now)`**: an `ACTIVE` Campaign with a non-null deadline in the past is effectively `EXPIRED`. Every other status, and a null deadline, is taken as stored.
- **Transition table** (effective status → result):

  | Command | From | To | Actor / capacity | Requires |
  | --- | --- | --- | --- | --- |
  | `decideSubmission(approve\|reject)` | SUBMITTED | ACTIVE / REJECTED | VERIFIER assignment, not owner (ticket 09); capacity VERIFIER | none |
  | `completeCampaign` | ACTIVE | COMPLETED | owner → FUNDRAISER; otherwise ADMIN assignment → ADMIN | ≥1 Campaign Update; reason if ADMIN |
  | `flagCampaign` | ACTIVE, EXPIRED, COMPLETED | (no change) | VERIFIER assignment, not owner (ticket 09) | reason |
  | `dismissFlag` | open Flag | Flag DISMISSED | ADMIN, not owner | reason |
  | `suspendCampaign` | ACTIVE, EXPIRED, COMPLETED | SUSPENDED | ADMIN, not owner | reason; resolves open Flags as SUSPENDED |
  | `liftSuspension` | SUSPENDED | status before Suspension (ACTIVE re-evaluated → EXPIRED if deadline passed) | ADMIN, not owner, not the actor of the latest Suspension | reason |
  | `requestCancellation` | ACTIVE | (no change; request PENDING) | owner | reason; no other PENDING request |
  | `decideCancellation(approve)` | ACTIVE | CANCELLED | ADMIN, not owner | reason; no Payout COMPLETED on the Campaign |
  | `decideCancellation(reject)` | pending request | request REJECTED | ADMIN, not owner | reason |
  | `setUrgent(true\|false)` | ACTIVE (for `true`) | flag only | ADMIN, not owner | reason |

  COMPLETED, CANCELLED and REJECTED have no outgoing transition except SUSPENDED from COMPLETED (ADR 0015). DRAFT is not touched by this spec.
- **Actor**: each command takes `{ userId, assignments }` plus the Campaign id and the command's input. Authorization lives in the module, not only in route wrappers, because "owner or Admin" and "never Admin on your own Campaign" cannot be expressed as a single-assignment check. The "not owner" rule applies to every ADMIN-capacity action and, since ticket 09, to every VERIFIER-capacity action too (CONTEXT.md, Verifier). Because the Cancellation requester is always the owner, it also guarantees the approver differs from the requester.
- **Reasons**: required, trimmed, non-empty and length-capped for every ADMIN-capacity action, for Flags and for Cancellation requests. Not required for a Fundraiser completing their own Campaign (their Campaign Update is the explanation) or for Verifier approve/reject (reasons belong to Verification Request, ticket 12).
- **Typed errors**, in the style of the Payout service: not found, not authorized (missing assignment, not owner), own-Campaign conflict, same-Admin lift, invalid transition (wrong effective status), concurrent transition, missing Campaign Update, Payout already completed, Cancellation already pending, validation (missing reason).

### Side effects of leaving Active

Any transition out of effective ACTIVE (COMPLETED, SUSPENDED, CANCELLED, or lazy EXPIRED) does all of the following in the same transaction:
- clears Urgent if set, logging it with capacity SYSTEM;
- marks any PENDING Cancellation request SUPERSEDED.

### Lazy expiry

When a command finds a Campaign stored ACTIVE but effectively EXPIRED, it first records EXPIRED (log capacity SYSTEM, including the leave-Active side effects) in **its own committed transaction**, then evaluates the command against EXPIRED. A refused command must not roll back the expiry. The scheduled job of ticket 20 later performs the same write through the same function.

### Concurrency

Every status write is a predicated `updateMany` on `{ id, lifecycleStatus: <expected> }`. Zero rows updated becomes the concurrent-transition error (409). Cancellation approval additionally locks the Campaign row and checks "no Payout COMPLETED" inside that lock, using the same row-locking pattern as the balance-touching Payout operations.

### Dual-write

- The legacy string is still written alongside the enum.
- The string → enum mapping gains `cancelled → CANCELLED`.
- A new enum → string mapping (`toLegacyStatus`) is added, because Lift restores the prior status read from the log as an enum.
- Readers that filter the string on `'active'` keep working unchanged.

### Schema changes

- **`CampaignStatusChange`** (append-only, never updated or deleted): `id`, `campaignId`, `action` (enum: `SUBMISSION_APPROVED`, `SUBMISSION_REJECTED`, `COMPLETED`, `SUSPENDED`, `SUSPENSION_LIFTED`, `CANCELLED`, `EXPIRED`, `URGENT_SET`, `URGENT_CLEARED`), `fromStatus` and `toStatus` (CampaignStatus, both null for Urgent actions), `actorId` (null for SYSTEM), `capacity` (enum: `FUNDRAISER`, `VERIFIER`, `ADMIN`, `SYSTEM`), `reason` (nullable), `createdAt`. Indexed on `(campaignId, createdAt)`. Lift reads the latest `SUSPENDED` row for its `fromStatus` and `actorId`.
- **`CampaignFlag`**: `id`, `campaignId`, `verifierId`, `reason`, `createdAt`, `resolution` (enum `SUSPENDED` | `DISMISSED`, nullable while open), `resolvedById`, `resolutionReason`, `resolvedAt`.
- **`CancellationRequest`**: `id`, `campaignId`, `requestedById`, `reason`, `status` (enum `PENDING`, `APPROVED`, `REJECTED`, `SUPERSEDED`), `decidedById`, `decisionReason`, `createdAt`, `decidedAt`. At most one PENDING per Campaign, enforced in the service inside the transaction.
- `Campaign.isUrgent` stays. It is written only by the lifecycle module.
- One additive migration. No backfill: existing Campaigns simply have no history rows.

### API contracts

All routes are thin adapters under the Campaign resource, addressed by slug:
- `POST /api/campaigns/[slug]/complete` `{ reason? }`
- `POST /api/campaigns/[slug]/flags` `{ reason }`; `POST /api/campaigns/[slug]/flags/[id]/dismiss` `{ reason }`
- `POST /api/campaigns/[slug]/suspension` `{ reason }`; `DELETE /api/campaigns/[slug]/suspension` `{ reason }`
- `POST /api/campaigns/[slug]/cancellation-requests` `{ reason }`; `POST /api/campaigns/[slug]/cancellation-requests/[id]/approve` `{ reason }`; `POST .../reject` `{ reason }`
- `PUT /api/campaigns/[slug]/urgent` `{ urgent: boolean, reason }`
- The existing moderation endpoint keeps `approve` and `reject` and delegates to `decideSubmission`. `suspend` is removed and answers 400 like any unknown action.

Each adapter maps session → actor (401 without session) and typed error → status:

| Typed error | Status |
| --- | --- |
| validation | 400 |
| not authorized, own-Campaign conflict, same-Admin lift | 403 |
| not found | 404 |
| invalid transition, concurrent transition, Payout already completed, Cancellation already pending | 409 |
| missing Campaign Update | 422 |

Every error carries an Indonesian user-facing message. Success returns the updated Campaign's `lifecycleStatus` and `isUrgent`, plus the created Flag or request where relevant.

### Notifications

Within the same transaction, an in-app Notification goes to the Campaign's creator for every action whose actor is not the creator (Suspension, Lift, Admin completion, Cancellation decision, SYSTEM expiry), carrying the reason. No Donor notification. Email waits for the mailer (ticket 13). The existing moderation messages are reworded to drop "moderator".

### Cleanup and documents

- Delete the unused `determineCampaignStatus` utility and its test (it encodes "target met = completed", contrary to ADR 0004).
- Update the Campaign status dual-write guard's writer and reader literals to include the lifecycle module and the new routes.
- Amend PRD §8 to match ADR 0015 (Suspended reachable from Expired and Completed).
- Add Urgent to the Admin role row in PRD §4.

## Testing Decisions

- **Good tests assert external behaviour**: the result of a command (returned Campaign state, the typed error) and what is persisted (the Campaign row, log rows, Flags, requests, Notifications). They do not assert which Prisma methods were called in which order, except where the predicate *is* the behaviour (the `lifecycleStatus` guard on the status write).
- **Seam 1, lifecycle module (full coverage)**: every row of the transition table, allowed and refused, from every effective status. Also:
  - owner vs. Admin capacity, the own-Campaign conflict, and the same-Admin lift;
  - reason validation;
  - the Campaign Update requirement for both capacities;
  - Lift restoring ACTIVE, EXPIRED and COMPLETED, and ACTIVE-past-deadline landing on EXPIRED;
  - lazy expiry persisting when the command is refused;
  - leave-Active side effects (Urgent cleared, pending request superseded) for each exit;
  - Flags resolved on Suspension;
  - "no Payout COMPLETED" on Cancellation approval;
  - the concurrent-transition error when the predicated write matches zero rows;
  - log rows with correct action, from/to, actor and capacity;
  - Notifications only for non-creator actors.

  Prior art: the Payout service tests, which run the real service against an in-memory stand-in for the Prisma transaction client and assert typed errors.
- **Seam 2, every route (full coverage, per the user's choice)**: each route is tested end to end through its handler, repeating the rule cases relevant to that action with Prisma mocked in the established route-test style:
  - 401 without session;
  - 403, 404, 409, 422 and 400 cases;
  - success bodies;
  - persisted effects;
  - removal of `suspend` from moderation, and approve/reject refused outside SUBMITTED.

  Prior art: the moderation route test and the Payout route tests with their in-memory ledger simulation.
- **Static guard**: the dual-write property test keeps proving every Campaign writer sets both columns. It is updated, not weakened.
- Existing tests that asserted Verifier suspension, or approval from non-SUBMITTED statuses, are rewritten to assert the refusal.

## Out of Scope

- The money-layer effects of Suspension: freezing Escrow Hold and Campaign Balance, refusing Payouts, and hiding from the catalogue beyond today's `'active'` filter. Ticket 30 of `prd-compliance-fase-0-2` is narrowed to exactly these.
- Refunds triggered by Suspension or Cancellation, and the refund queue for money arriving after closure (ticket 32).
- Transferring `zakat`/`wakaf` funds on Suspension (ticket 33). Kind does not exist yet.
- The scheduled expiry job (ticket 20). This spec only provides the lazy path and the function the job will call.
- Email notifications (ticket 13). Donor notifications of any kind.
- Verification Request, including rejection reasons and resubmission from REJECTED (ticket 12).
- UI: Fundraiser "mark Completed" and "request Cancellation" buttons, the Admin Flag queue, Suspension, Urgent and Cancellation-decision screens, and showing the Suspension reason on the Fundraiser dashboard. Follow-up UI work reads the log this spec creates.
- Campaign DELETE bypassing Cancellation (gap C11 / top-10 #9).
- Revoking roles gained through the old self-verification (C2 remainder).

## Further Notes

- **Prerequisite**: the uncommitted webhook change that stops the Settlement webhook from writing `completed` must merge before or together with this work. Until it does, the webhook remains a second, illegal path to Completed, and it can overwrite a Suspension.
- **Operational prerequisite**: lifting a Suspension needs at least two people holding the ADMIN assignment. The Payout and Refund two-person rules already demand this before Fase 2. There is deliberately no single-Admin override.
- ADR 0015 records the deliberate deviation from PRD §8. `CONTEXT.md` defines Flag, Urgent, the Suspension lift rule, lapsing Cancellation requests and the Admin-on-own-Campaign rule.
- The approach follows the parent spec's rule that "every status transition uses a predicated update so two Admins clicking at once produce one change".
