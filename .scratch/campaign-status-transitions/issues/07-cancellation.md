# 07: Cancellation requested by the Fundraiser, decided by an Admin

**What to build:** A Fundraiser asks to withdraw their Active Campaign honestly, with a reason. The Campaign keeps accepting Donations until an Admin decides. An Admin approves (the Campaign becomes Cancelled) or rejects, with a reason. Approval is possible only while no Payout on the Campaign has Completed. A pending request lapses if the Campaign leaves Active first.

**Blocked by:** 02

**Status:** done

- [ ] Additive migration creates `CancellationRequest` (requester, reason, status PENDING/APPROVED/REJECTED/SUPERSEDED, decider, decision reason, times)
- [ ] The legacy-string mapping gains `cancelled`
- [ ] `POST /api/campaigns/[slug]/cancellation-requests` with a required reason:
  - owner only (403 otherwise);
  - allowed on effective ACTIVE (409 otherwise);
  - 409 while another request is PENDING;
  - the Campaign stays ACTIVE
- [ ] `POST .../cancellation-requests/[id]/approve` and `.../reject` with a required reason:
  - require the ADMIN assignment;
  - 403 for the owner;
  - 409 when the request is not PENDING
- [ ] Approval:
  - locks the Campaign row and refuses with 409 when any Payout on it is COMPLETED;
  - allowed only from effective ACTIVE (a past-deadline Campaign is recorded Expired and the request lapses);
  - writes CANCELLED, logs it, and clears Urgent through the leave-Active hook
- [ ] The leave-Active hook marks any PENDING request SUPERSEDED on every exit (Completed, Suspended, Expired, Cancelled)
- [ ] The Fundraiser gets an in-app notification with the reason when their request is approved or rejected
- [ ] Tests, full at both seams (lifecycle module and routes)

## Comments

- 2026-09-25: The `cancelled` legacy-string mapping already landed in ticket 02 (spec Dual-write section). Nothing left to do for that criterion here.
