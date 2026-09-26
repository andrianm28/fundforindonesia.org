# 03: Mark a Campaign Completed (Fundraiser or Admin)

**What to build:** A Fundraiser marks their own Active Campaign Completed once it has at least one Campaign Update. An Admin does the same for a Campaign they do not own, giving a reason. Completed is final. Reaching the target never completes a Campaign on its own (ADR 0004, PRD §8, FFI-03).

**Blocked by:** 01, 02

**Status:** done

- [ ] `POST /api/campaigns/[slug]/complete` with an optional reason
- [ ] Capacity:
  - the owner acts as FUNDRAISER (this includes an owner who also holds ADMIN), and needs no reason;
  - a non-owner needs the ADMIN assignment and a reason, otherwise 403 or 400
- [ ] Refused with 422 when the Campaign has no Campaign Update, for both capacities
- [ ] Allowed only from effective ACTIVE:
  - an Active Campaign past its deadline is recorded Expired and the completion is refused with 409;
  - Suspended, Expired, Cancelled, Rejected, Submitted and already-Completed Campaigns are refused with 409
- [ ] Writes both status columns, logs COMPLETED with actor and capacity, and clears Urgent through the leave-Active hook
- [ ] An in-app notification with the reason goes to the Fundraiser when an Admin completed the Campaign; none when the Fundraiser did it themselves
- [ ] Two simultaneous completions produce one change and one 409
- [ ] Tests, full at both seams (lifecycle module and route)
