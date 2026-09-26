# 05: Suspension and lifting it

**What to build:** An Admin suspends a Campaign that is Active, Expired or Completed, with a reason (ADR 0015, FFI-07b). A different Admin lifts it, with a reason. The Campaign then returns to the status it had before, except that one which was Active and whose deadline passed during the Suspension becomes Expired. The Fundraiser is told what happened and why.

**Blocked by:** 02

**Status:** done

- [ ] `POST /api/campaigns/[slug]/suspension` with a required reason. Requires the ADMIN assignment; 403 when the Admin owns the Campaign
- [ ] Suspension allowed from effective ACTIVE, EXPIRED and COMPLETED; refused with 409 from SUSPENDED, CANCELLED, REJECTED, SUBMITTED
- [ ] `DELETE /api/campaigns/[slug]/suspension` with a required reason:
  - requires the ADMIN assignment;
  - 403 for the owner;
  - 403 for the Admin who imposed the latest Suspension, with a message that another Admin must lift it
- [ ] Lift restores the prior status read from the latest SUSPENDED log row (COMPLETED → COMPLETED, EXPIRED → EXPIRED, ACTIVE → ACTIVE, or EXPIRED if the deadline has passed)
- [ ] Suspending an Active Campaign clears Urgent through the leave-Active hook; lifting never restores Urgent
- [ ] Both actions are logged with actor, capacity ADMIN and reason; each sends an in-app notification with the reason to the Fundraiser
- [ ] Simultaneous suspend/lift attempts produce one change and one 409
- [ ] PRD §8 amended to match ADR 0015
- [ ] Tests, full at both seams (lifecycle module and route)
