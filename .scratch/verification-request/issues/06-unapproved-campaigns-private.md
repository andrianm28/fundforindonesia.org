# 06: Unapproved Campaigns are visible only to their Fundraiser, Verifiers and Admins

**What to build:** `GET /api/campaigns/[slug]` and the Campaign page (`/campaign/[slug]`, including its donate page) answer 404 for a Campaign whose effective status is DRAFT, SUBMITTED or REJECTED. The exceptions are the Campaign's Fundraiser and holders of the VERIFIER or ADMIN assignment, who see it with its status banner. Responses for unapproved Campaigns are never shared-cached (`private, no-store`). Approved statuses behave as today. See CONTEXT.md (Campaign Status).

**Blocked by:** 05 (same route file)

**Status:** done

- [ ] Anonymous users and other users get 404 for DRAFT, SUBMITTED and REJECTED, on the API, the page and the donate page
- [ ] The Fundraiser, a Verifier and an Admin can open them; an owning Verifier still can (viewing is not acting)
- [ ] Unapproved responses carry `Cache-Control: private, no-store`; approved ones keep today's caching
- [ ] Tests cover each viewer × status. Full suite green, tsc adds no errors
