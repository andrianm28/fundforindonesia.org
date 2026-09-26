# 30: Suspension and Cancellation

**What to build:** A problem Campaign can be frozen, and a Fundraiser who withdraws honestly is visibly not the same thing.

**Blocked by:** 5, 8

**Status:** wontfix

- [ ] A Verifier reports a Campaign; an Admin decides Suspension
- [ ] Suspension stops Donations, freezes Escrow Hold and Campaign Balance, refuses Payouts and hides the Campaign from the catalogue
- [ ] The reason is recorded and shown to the Fundraiser; another Admin may lift it
- [ ] Cancellation is requested by the Fundraiser and approved by an Admin, only while no Payout has completed
- [ ] The Campaign page distinguishes the two

## Comments

- 2026-09-25: Scope narrowed by `.scratch/campaign-status-transitions/spec.md` (gap C20). That spec now owns the transitions themselves: Flag by Verifier, Suspension and Lift by different Admins with reasons, Cancellation request and decision, the status-change log and the Fundraiser notification. What remains here is the effect of being SUSPENDED: freezing Escrow Hold and Campaign Balance, refusing Payouts, hiding from the catalogue, and the Campaign page distinguishing Suspended from Cancelled.
- 2026-09-25: The remaining scope (freeze Escrow Hold and Campaign Balance, refuse Payouts, and the Campaign page telling Suspended apart from Cancelled) moved to `.scratch/subject-guard-and-suspension-money/`. Hiding from the catalogue already holds through the `'active'` filter and moves to architecture candidate 3. Closed here as superseded.
