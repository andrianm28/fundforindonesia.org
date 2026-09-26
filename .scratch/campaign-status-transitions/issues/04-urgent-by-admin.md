# 04: Urgent set and cleared by an Admin

**What to build:** An Admin sets or clears Urgent on an Active Campaign, with a reason, so the homepage urgent rail and the urgent filter reflect an operator's judgement. Urgent drops automatically whenever the Campaign leaves Active and does not come back without a new Admin decision.

**Blocked by:** 02

**Status:** done

- [ ] `PUT /api/campaigns/[slug]/urgent` with `urgent` and a required reason; ADMIN assignment required
- [ ] Refused with 403 when the Admin owns the Campaign
- [ ] Setting is allowed only on effective ACTIVE: an Active Campaign past its deadline is recorded Expired and refused with 409. Clearing is allowed whenever the flag is set
- [ ] Each change is logged as URGENT_SET / URGENT_CLEARED with actor, capacity ADMIN and reason
- [ ] Nothing outside the lifecycle module writes `isUrgent`
- [ ] PRD §4 Admin role row mentions Urgent
- [ ] Tests, full at both seams (lifecycle module and route)
