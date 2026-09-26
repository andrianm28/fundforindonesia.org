# 08: Approval requires every required checklist item ticked

**What to build:** `decideVerificationRequest` refuses an approve when any item marked `required` in the request's own checklist snapshot is not ticked. It answers 409, or 422 if that fits the error family better (report which), with a typed code and an Indonesian message naming the missing items. Rejection needs no ticks. The moderation page disables "Loloskan" until every required item is ticked, and shows why. See CONTEXT.md (Verification Request).

**Blocked by:** 02

**Status:** done

- [ ] Approve with a required item unticked is refused with a typed code, and nothing changes (request still PENDING, Campaign still SUBMITTED, no Identity Verification)
- [ ] Approve with all required items ticked, optional ones not, succeeds
- [ ] Reject works with any ticks
- [ ] The page disables approve until every required item is ticked. Full suite green, tsc adds no errors
