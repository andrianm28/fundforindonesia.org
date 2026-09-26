# 02: A Verifier never moderates their own Volunteer Trip

**What to build:** The Volunteer Trip moderation route refuses a Verifier who is the Trip's Fundraiser, with 403 `OWN_TRIP_CONFLICT` worded for the Verifier capacity. The Trip stays unchanged. Everyone else moderates as before. See `.scratch/operator-rule-gaps/spec.md` and CONTEXT.md (Verifier).

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] `OwnTripConflictError` takes a capacity (ADMIN or VERIFIER), like `OwnCampaignConflictError`. Existing Admin uses keep their wording and code
- [ ] The Trip moderation route refuses the owning Verifier through `domainErrorToHttp`; there is no status change and no notification
- [ ] Tests: an owner-Verifier refused on approve and on reject; a non-owner Verifier unchanged. Full suite green, tsc adds no errors
