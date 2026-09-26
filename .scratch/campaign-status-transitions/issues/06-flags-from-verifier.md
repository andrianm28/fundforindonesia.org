# 06: Flags from a Verifier

**What to build:** A Verifier raises a Flag on a Campaign with a reason, so an Admin can decide on Suspension. This works also on a Campaign that is already Expired or Completed. An Admin dismisses a Flag with a reason. A Suspension resolves every open Flag on the Campaign.

**Blocked by:** 05

**Status:** done

- [ ] Additive migration creates `CampaignFlag` (verifier, reason, time, resolution SUSPENDED/DISMISSED, resolver, resolution reason, resolution time)
- [ ] `POST /api/campaigns/[slug]/flags` with a required reason:
  - requires the VERIFIER assignment;
  - allowed on effective ACTIVE, EXPIRED and COMPLETED, 409 otherwise;
  - several open Flags per Campaign are kept separately
- [ ] `POST /api/campaigns/[slug]/flags/[id]/dismiss` with a required reason:
  - requires the ADMIN assignment;
  - 403 for the owner;
  - 409 when the Flag is already resolved
- [ ] Suspending a Campaign marks all its open Flags SUSPENDED, with the suspending Admin as resolver, in the same transaction
- [ ] Tests, full at both seams (lifecycle module and routes)
