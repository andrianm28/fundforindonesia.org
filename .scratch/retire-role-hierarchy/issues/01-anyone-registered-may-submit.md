# 01: Anyone registered may submit; Payouts need ownership, not a Role

**What to build:** Remove every CAMPAIGN_CREATOR gate:
- `withRoleCheck('CAMPAIGN_CREATOR')` on Campaign create, Trip create and both Payout request routes;
- `legacyCampaignCreatorGate` on the owner routes;
- the middleware's `/campaign/create` rank gate (login is still required);
- the create-page and account-page rank checks, and their "ask an Admin" copy.

A registered user with no Role or assignment can submit a Campaign or Trip, which lands as SUBMITTED for a Verifier. The owner of an approved Campaign can request a Payout. See `.scratch/retire-role-hierarchy/spec.md` and CONTEXT.md (Fundraiser).

**Blocked by:** legacy-status-contract 02 (same create route)

**Status:** done

- [ ] A DONOR-Role user with no assignments creates a Campaign (SUBMITTED) and a Trip. An anonymous user is still refused
- [ ] Payout request works for the owner whatever their Role, and is refused for a non-owner (403 `NOT_AUTHORIZED`)
- [ ] No `withRoleCheck('CAMPAIGN_CREATOR')`, `isAtLeast(…,'CAMPAIGN_CREATOR')` or `legacyCampaignCreatorGate` remains; the roles guard asserts it
- [ ] The create and account pages have no rank check or "ask an Admin" copy. Full suite green, tsc adds no errors
