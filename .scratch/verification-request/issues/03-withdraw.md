# 03: A Fundraiser withdraws an undecided Verification Request

**What to build:** `withdrawVerificationRequest` (FUNDRAISER, request PENDING) marks the request WITHDRAWN. The Campaign goes back to DRAFT if it was its first request, or to REJECTED if it was a resubmission. The transition is logged, and the Verifier queue no longer shows it. The Fundraiser's Campaign page offers "Tarik pengajuan" while a request is pending.

**Blocked by:** 02

**Status:** done

- [ ] Withdrawing a first request makes the Campaign DRAFT; withdrawing a resubmission makes it REJECTED
- [ ] Withdrawing a decided request is 409; a non-owner gets 403
- [ ] A withdraw committed before a Verifier's lock makes the decision 409, and the reverse order also yields one outcome
- [ ] Full suite green, tsc adds no errors
