# 05: Content edits follow the Campaign status

**What to build:** `PATCH /api/campaigns/[slug]` (content fields only: title, description, story, cover image) is allowed while the Campaign is DRAFT, REJECTED or ACTIVE. It is refused with 409 and a typed code while SUBMITTED (the Verifier is checking a fixed version) and in every final status (Suspended, Cancelled, Completed, Expired, effective status). Authority is unchanged: the Fundraiser, or an Admin through the Capacity judgement. See CONTEXT.md (Verification Request) and `.scratch/verification-request/spec.md`.

**Blocked by:** 01

**Status:** done

- [ ] Edits succeed in DRAFT, REJECTED and ACTIVE, and are refused (409, typed code, Indonesian message) in SUBMITTED, SUSPENDED, CANCELLED, COMPLETED and EXPIRED, including an Active Campaign past its deadline
- [ ] The status is judged under the Campaign row lock, or with a predicated write, so an edit cannot land after a concurrent submit
- [ ] Route tests cover every status. Full suite green, tsc adds no errors
