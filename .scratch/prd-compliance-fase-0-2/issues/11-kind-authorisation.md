# 11: Kind Authorisation with expiry

**What to build:** A Verifier grants a dated authorisation letting a Partner Organisation run zakat or wakaf Campaigns, and the platform warns before it lapses instead of failing silently.

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] A Verifier grants a dated Kind Authorisation for zakat or wakaf to a Partner Organisation
- [ ] An individual Fundraiser can only ever run Kind donation
- [ ] When the date passes, Campaigns of that Kind stop accepting Donations but stay visible and their funds stay withdrawable
- [ ] Renewal reopens them immediately
- [ ] A warning is raised 30 days before expiry

## Comments
- 2026-09-26 (grilling): a Verifier grants the Kind Authorisation (Kind, valid from and to, document reference) to a Partner Organisation, with an audit trail. An individual Fundraiser can only run Kind `donation`. Accepting Donations for zakat, wakaf and hibah is computed lazily from the authorisation date, like the permit in ticket 10, so no cron is needed. The 30-day warning is a "expiring soon" list on the Verifier dashboard (permits and authorisations) in Phase 0. Email reminders wait for scheduled jobs (ticket 20) and the Mailer (ticket 13).
