# 02: A Verifier decides a Verification Request, with a checklist and a reason

**What to build:** `decideVerificationRequest` replaces `decideSubmission`:
- The actor needs the VERIFIER Capacity and must not own the Campaign.
- The request must be PENDING.
- The Verifier records the checklist ticks.
- Approve moves SUBMITTED to ACTIVE. Reject moves it to REJECTED, with a required reason.
- Approving a Fundraiser's first request creates their Identity Verification.
- The Fundraiser is notified in-app with the outcome and reason; email waits for ticket 13.
- The moderation route and page use it, and the page shows the checklist and a reason field.
- A decided request is never modified again.

**Blocked by:** 01

**Status:** done

- [ ] Reject without a reason is 400; deciding a non-PENDING request is 409; the owning Verifier gets 403 `OWN_CAMPAIGN_CONFLICT`
- [ ] The first approval creates exactly one Identity Verification; later approvals do not
- [ ] Every decision stores the checklist ticks, outcome, reason, actor and time, and logs the status transition
- [ ] The moderation page renders the checklist. Full suite green, tsc adds no errors
