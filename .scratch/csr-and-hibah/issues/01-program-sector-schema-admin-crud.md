# 01: Program and Sector schema, Admin CRUD

**What to build:** The `Program` model and the fixed `Sector` enum exist, and an
Admin can create and edit a Program from a panel. This is the foundation every
other CSR ticket in this feature builds on.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `Sector` is a four-value enum (`HEALTH`, `EDUCATION`, `ENVIRONMENT`,
      `DISABILITY_INCLUSION`) defined in code, with no Admin-facing way to add,
      remove, or rename a value
- [ ] `Program` carries problem, target beneficiaries, location, activities,
      budget, timeline, KPIs, documentation, impact report, and a `sector`
      field — no `Kind`, no relation any payment/escrow/payout code path can
      reach
- [ ] `Program` also carries a plain reported figure for CSR money that never
      crossed the platform's account (see Further Notes), editable only by an
      Admin, separate from anything the ledger produces
- [ ] `POST /api/programs` and `PATCH /api/programs/[id]` let an Admin create
      and edit a Program (all fields above); non-Admin callers are refused
- [ ] A `Program` is never reachable from `Donation`, `Payment`, escrow, or
      `Payout` code — this is an invariant to test (e.g. a type-level or
      schema-level check that these models have no Program foreign key), not
      merely a fact to state
- [ ] Existing Category (Campaign) and the new Sector (Program) enums are
      kept structurally separate — no shared type, no shared table

## Further Notes

- The off-books reported figure's exact shape (a single amount, or amount +
  as-of date/description) is left to the builder's judgement — the spec only
  requires it be a plain number distinct from anything the ledger produces.
  Whatever shape is chosen, ticket 08 (off-books display) and ticket 07
  (Program Balance ledger crediting) must not conflate it with the
  ledger-backed Program Balance.
