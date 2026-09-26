# 04: Fundraiser withdraws a Trip's collected Trip Fees

**What to build:** A Fundraiser can request a payout of their Volunteer Trip's withdrawable balance, the same way they'd request a Campaign's Payout — same two-person rule, same review-before-transfer shape. Escrow for Trip Fee payments already matures into a Trip's balance automatically as a byproduct of Ticket 01's generalized sweep and Ticket 03's real settlements; this ticket's own work is the payout request/approval surface itself, plus giving the Fundraiser visibility into what's pending versus withdrawable.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] `POST /api/volunteer-trips/[slug]/payouts` — the owning Fundraiser requests a payout from their Trip's `TRIP_BALANCE`, mirroring `POST /api/campaigns/[slug]/payouts` including its escrow-release-at-the-top-of-the-request pattern.
- [ ] Trip payout approval reuses the same two-person rule as Campaign payout: the approver must not be the requester, enforced the same way `requestPayout`/`approvePayout` (or their Trip-scoped equivalents, built the same way) already enforce it for Campaign — including the row-lock discipline `SELECT ... FOR UPDATE` already established for Campaign payout approval, applied to the Trip's balance-bearing row instead.
- [ ] A Trip payout cannot be requested for more than the Trip's current `TRIP_BALANCE`.
- [ ] `GET` surface (route shape left to the implementer, matching whatever pattern Campaign uses for showing its own Escrow Hold/Campaign Balance) for the Fundraiser to see their Trip's Escrow Hold and Trip Balance.
- [ ] Regression test: a Trip's `TRIP_BALANCE` can never be the source of a Campaign `Payout`, and a Campaign's `CAMPAIGN_BALANCE` can never be the source of a Volunteer Trip payout, however either is requested.
- [ ] Regression test: requesting a Trip payout as someone other than the owning Fundraiser is refused.

**Context:** Ticket 4 of 6 from `.scratch/volunteer-trip/spec.md`.
