# 12: Verification Request entity

**What to build:** Submitting a Campaign creates a reviewable request with a document checklist, and every rejection and resubmission is kept, so a Campaign's history of refusals survives.

**Blocked by:** 5

**Status:** ready-for-agent

- [ ] Submitting creates a Verification Request; each resubmission creates a new one and none is overwritten
- [ ] The document checklist is configured per Kind from the Admin panel, not in code
- [ ] A Verifier passes or rejects with a reason; rejection returns the Campaign to Draft for revision, without limit
- [ ] A Fundraiser may withdraw a request while it is undecided, returning a first submission to Draft
- [ ] Changing target, deadline or Bank Account on an Active Campaign creates a new request while the Campaign keeps running on its old values; if refused, the change is discarded and the Campaign stays Active
- [ ] Identity of the Fundraiser is verified on their first request
- [ ] Every decision records who, when and what
- [ ] The checklist mechanism is per-Kind (general, not wakaf-only): `hibah` starts seeded identical to `wakaf`'s items, and the Admin editor can later diverge `hibah`'s checklist without touching `wakaf`'s (CSR-11 sequencing decision 2026-09-27)

## Comments

- 2026-09-26 (status tidy): First slice done through .scratch/verification-request (01-08: Draft, submit, decide with checklist and required items, Identity Verification, withdraw, Admin checklist editor, private unapproved Campaigns). Still open here: re-verification when target, deadline or Bank Account changes on an Active Campaign; per-Kind checklists (after 09); document upload (after 15-16).
