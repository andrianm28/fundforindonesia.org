# 01: One Capacity judgement, used by the lifecycle, money and Trip moderation

**What to build:** A pure Capacity judgement module decides whether an actor may act in a requested Capacity on a Campaign or Volunteer Trip, and returns the effective Capacity or one typed refusal. One error class for acting on your own record replaces the two current ones, keeping the codes `OWN_CAMPAIGN_CONFLICT` and `OWN_TRIP_CONFLICT`. The lifecycle runner's authority step, `requireNotOwnerAsAdmin`, the Trip moderation route's inline owner check and `approvePayout` all use it. See `.scratch/capacity-judgement/spec.md`.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] The judgement module is pure (no database). A table test covers subject kind × requested Capacity × owner × assignment
- [ ] One error class with one Indonesian template replaces `OwnCampaignConflictError` and `OwnTripConflictError`. Codes and HTTP status are unchanged, and both codes sit in one error family
- [ ] The lifecycle runner, the Refund functions (via the guard), the Trip moderation route and `approvePayout` ask the judgement. Every existing test stays green
- [ ] `approvePayout` refuses an Admin who owns the Campaign or Trip, under the lock, with a new test
- [ ] Full suite green, tsc adds no errors
