# 01: A Campaign past its deadline refuses a Donation

**What to build:** CONTEXT.md says only Active accepts a Donation, and an Active Campaign whose deadline has passed counts as Expired even before that is recorded. Today `POST /api/donations` asks only for the stored `lifecycleStatus`: the donation gate never sees the deadline, so a Donor can still pay into a Campaign whose deadline has passed. Fix this with the same rule the lifecycle commands use:
- When a Donation is requested for a stored-Active Campaign that is effectively Expired, run the existing lazy expiry first. That records EXPIRED with capacity SYSTEM and notifies the Fundraiser, exactly as for any other actor.
- Then refuse the Donation with the same response an Expired Campaign gets today.
- Campaigns without a deadline, including `wakaf`, never expire.

Catalogue, sitemap and Urgent-rail readers are out of scope (architecture candidate 3).

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] The donation gate decides from the effective status (status + deadline + now), not the stored status alone
- [ ] A Donation on a stored-Active Campaign past its deadline is refused, nothing is written for the Donation or Payment, and the Campaign is recorded EXPIRED (log row capacity SYSTEM, Fundraiser notified), even though the Donation itself was refused
- [ ] A Donation on an Active Campaign with a future deadline or no deadline still works as today
- [ ] Route tests cover all three cases; the existing donation tests stay green
