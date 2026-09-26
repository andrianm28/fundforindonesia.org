# 02: An Admin never creates or approves a Refund on their own Campaign

**What to build:** CONTEXT.md says an Admin never acts as Admin on a Campaign they own; on their own Campaign they are only its Fundraiser. `createRefund` and `approveRefund`, and their routes under `/api/campaigns/[slug]/refunds`, check only the ADMIN assignment, so an Admin who is the Campaign's Fundraiser can create or approve a Refund on it. Refuse both with 403 and the same `OWN_CAMPAIGN_CONFLICT` code and Indonesian message ("…harus dilakukan Admin lain") that the lifecycle module uses. Reuse the lifecycle module's error if that is clean; otherwise match its code and message exactly. Refunds for Volunteer Trips follow the same rule for the Trip's Fundraiser if the same functions serve them; check this and report it.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] `createRefund` refuses an Admin who is the Campaign's Fundraiser; nothing is written (no Refund row, no ledger legs, no freeze)
- [ ] `approveRefund` refuses an Admin who is the Campaign's Fundraiser; the Refund stays as it was
- [ ] Both routes answer 403 with code `OWN_CAMPAIGN_CONFLICT`
- [ ] The existing two-person rule (approver ≠ creator) is unchanged
- [ ] Tests at the money-module seam and the route seam; the full suite stays green
