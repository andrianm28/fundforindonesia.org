# 10: Partner Organisation, Collecting Entity and the permit gate

**What to build:** Every Campaign names the legal entity collecting its money, and cannot open unless that entity holds an unexpired Fundraising Permit for its Kind. A lapsed permit stops collection by itself rather than relying on anyone remembering.

**Blocked by:** 9

**Status:** done (PR #26, 485ec29)

- [ ] Partner Organisation exists; the Platform Operator can never be a Collecting Entity
- [ ] Every Campaign references a Collecting Entity, required before it may leave Draft
- [ ] An individual Fundraiser's Campaign names a sponsoring Partner Organisation, and the creation flow says so plainly
- [ ] A Campaign whose Collecting Entity has no valid Fundraising Permit for its Kind refuses to open, and an Active one stops accepting Donations when the permit lapses
- [ ] Implements ADR 0010

## Comments
- 2026-09-26 (grilling; CONTEXT.md Partner Organisation, Collecting Entity, Fundraising Permit): decisions that refresh this ticket for today's code:
  - A **Verifier** registers a Partner Organisation after checking its legal documents. It is linked to **one Fundraiser account** that acts for it (team members come in Phase 3), and has an `acceptsIndividualCampaigns` flag set by the Verifier.
  - A **Verifier** records Fundraising Permits: number, issuer, Kinds covered, valid from and to. Every registration and permit change is audited (actor, time).
  - A Campaign created by the linked account gets that organisation as its Collecting Entity automatically. An individual Fundraiser picks a sponsoring organisation from those that accept individual Campaigns. The Verifier confirms it when deciding the Verification Request (extend `decideVerificationRequest`).
  - **Accepting Donations is computed lazily**, like the effective status: no Collecting Entity, or no permit valid now for the Kind, means refused. Nothing is written on read. Extend `campaignAcceptsDonations` and the donate page banner.
  - An Active Campaign without a Collecting Entity refuses Donations until an Admin or Verifier assigns one through a dedicated screen.
  - Use the Capacity judgement and runner patterns, domain errors, and the CI working rules in `docs/agents/verification.md`.
  - Registering YIEM and its real permit is a human task: `.scratch/percepatan-produksi/issues/02`.

- 2026-09-26 (after merge). Agent assumptions, accepted by the main session and put to the owner:
  1. A Verifier cannot register or edit an organisation linked to their own account.
  2. A linked account's older Draft gets its organisation at submit time.
  3. Assigning an entity is only for an Active Campaign that has none. It never swaps an existing one, needs a reason, and the Fundraiser is notified.
  4. Someone holding both VERIFIER and ADMIN is recorded as Verifier (the new `VERIFIER_OR_ADMIN` Capacity).
  5. Permit days are whole days in WIB, and a Draft may have no entity.
  6. Approving counts as the Verifier's confirmation.
  - Open:
    - Receipt and Akad naming the Collecting Entity (tickets 21, 22) and ledger entries carrying it.
    - Assigning an entity does not require a valid permit.
    - `POST /api/donations` hard-codes its 403 instead of throwing a domain error.
    - "Sponsor" is not in CONTEXT.md.
    - There is no Draft-edit UI for picking the entity.
