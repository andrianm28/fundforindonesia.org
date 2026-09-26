# 32: Refund lifecycle end to end

**What to build:** An Admin can actually return a Donor's money, with the same two-person protection as a Payout, and the Donor supplies their account through a private link.

**Blocked by:** 13, 31, 8

**Status:** ready-for-agent

- [ ] Status moves Requested, AwaitingDonorDetails, Approved, Processing, Completed, with rejection from the first two and failure from Processing returning to AwaitingDonorDetails
- [ ] Creating a Refund immediately moves the money by journal to Frozen Balance, so it stops being available and cannot join a Payout
- [ ] The Donor receives a signed link, valid 30 days, that opens only a bank account form and reveals nothing else; an expired link can be reissued at any time and the money stays frozen meanwhile
- [ ] A Verifier checks the destination account and the holder name against the Donation; an anonymised Donation cannot be refunded through the system
- [ ] The creating, approving and completing Admins are subject to the same distinctness rule as Payout
- [ ] Completion requires proof of transfer
- [ ] The Donor is emailed when the Refund is created, when details are needed, and when the money is sent; the Fundraiser is told the effect on Campaign Balance

## Comments

- 2026-09-25 (architecture review): Admins never act as Admin on their own Campaign (CONTEXT.md, Admin). The Refund "complete" step must refuse an Admin who is the Campaign's Fundraiser, the same as create and approve (see `.scratch/campaign-rule-bugs/issues/02`).
