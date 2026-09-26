# 02: Lifecycle foundation, with moderation going through it

**What to build:** Campaign status changes get one home: the Campaign lifecycle module, backed by an append-only status-change log. The first caller is the Verifier moderation endpoint:
- It approves or rejects only Submitted Campaigns.
- It can no longer suspend, nor bring a Suspended, Completed or Cancelled Campaign back to Active.
- Every decision is recorded with who acted and in what capacity.

This ticket also lays the shared machinery every later transition uses. See spec `.scratch/campaign-status-transitions/spec.md`, sections "One lifecycle module", "Side effects of leaving Active", "Lazy expiry", "Concurrency", "Dual-write".

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Additive migration creates the append-only `CampaignStatusChange` log (action, from/to status, actor, capacity FUNDRAISER/VERIFIER/ADMIN/SYSTEM, reason, time), indexed by Campaign and time
- [x] The lifecycle module exposes:
  - `effectiveStatus` (an Active Campaign past its deadline counts as Expired);
  - the enum → legacy-string mapping;
  - typed errors (not found, not authorized, own-Campaign conflict, same-Admin lift, invalid transition, concurrent transition, missing Campaign Update, Payout already completed, Cancellation already pending, validation);
  - one shared mapping from those errors to 400/403/404/409/422 with Indonesian messages
- [x] Status writes are predicated on the expected `lifecycleStatus`; zero rows updated yields the concurrent-transition error
- [x] Lazy expiry: acting on a stored-Active, effectively-Expired Campaign first records EXPIRED (capacity SYSTEM) in its own committed transaction, and that record survives even when the action is then refused
- [x] Leaving Active clears Urgent in the same transaction and logs it with capacity SYSTEM (the hook later tickets extend)
- [x] Moderation `approve`/`reject` go through the module:
  - allowed only from SUBMITTED, 409 otherwise;
  - logged with capacity VERIFIER;
  - `suspend` is rejected as an unknown action (400)
- [x] Moderation notifications to the Fundraiser no longer say "moderator"
- [x] The unused "target met = completed" status utility and its test are deleted
- [x] The dual-write guard's writer and reader lists include the lifecycle module
- [x] Tests, full at both seams: the lifecycle module against an in-memory Prisma stand-in (Payout service test style), and the moderation route end to end
