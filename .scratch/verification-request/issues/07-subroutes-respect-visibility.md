# 07: Campaign sub-resources respect the same visibility

**What to build:** Since ticket 06, `GET /api/campaigns/[slug]` answers 404 for an unapproved Campaign (Draft, Submitted, Rejected) to anyone but its Fundraiser, Verifiers and Admins. Its public sub-resources still answer 200 for an unapproved slug:
- `GET /api/campaigns/[slug]/updates`, which returns its content;
- `/donations`;
- `/disbursements`.

That reveals the Campaign exists and leaks content. Gate each through `mayViewCampaign` (src/lib/campaign-visibility.ts). Unapproved gives 404, identical to a missing slug, with `private, no-store`. Approved Campaigns are unchanged. Also check any other public GET under `/api/campaigns/[slug]/` and list what you gated.

**Blocked by:** 06

**Status:** done

- [ ] Each public sub-resource GET answers 404 (`private, no-store`) for an unapproved Campaign to non-privileged viewers, and works as today for privileged viewers and approved Campaigns
- [ ] A static or table test pins that every public GET under `/api/campaigns/[slug]/` consults the visibility rule
- [ ] Full suite green, tsc adds no errors
