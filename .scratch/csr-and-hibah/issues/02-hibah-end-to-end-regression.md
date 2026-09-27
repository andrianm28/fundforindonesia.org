# 02: Hibah rides the existing Kind-generic machinery, proven end to end

**What to build:** Nothing new is built here — this ticket proves and locks
in, with regression tests, that Kind `hibah` already works through every piece
of Kind-generic machinery the parent spec built for `zakat`/`wakaf`: creation
gated by Kind Authorisation, the same nominal/Receipt/anonymity donor flow as
Donasi, and the deadline rule. `Kind`, `KindAuthorisation`, and
`requiresKindAuthorisation` (`src/lib/collecting-entity.ts`) are already
Kind-generic (`kind !== "DONATION"`) and `HIBAH` is already in the `Kind` enum
and `KINDS`/`KIND_LABEL` (`src/lib/campaign-kind.ts`), so this should mostly
be missing test coverage, not missing code — if a gap turns up, fix it here
rather than assuming the generic path already covers it.

**Blocked by:** None (Kind, Kind Authorisation, and campaign-kind.ts already
carry `HIBAH`)

**Status:** ready-for-agent

- [ ] A Fundraiser can create a Campaign of Kind `hibah` only when their
      Collecting Entity holds a valid, unexpired Kind Authorisation for
      `hibah`; without one, creation (or donation-acceptance) is refused the
      same way it already is for `zakat`/`wakaf`
- [ ] A deadline is mandatory on a `hibah` Campaign (only `wakaf` is exempt) —
      confirm `deadlineRequired` in `src/lib/campaign-kind.ts` already covers
      this and add the missing test if it's untested
- [ ] A Donor Hibah gets the same nominal choices, Receipt, and anonymity
      options as any other Donor, exercised through the same donation route
      seam the parent spec already tests for `donation`/`zakat`/`wakaf`
- [ ] An individual Fundraiser (no Partner Organisation) cannot create a
      `hibah` Campaign, same as `zakat`/`wakaf`
- [ ] `KIND_LABEL.HIBAH` ("Hibah") appears everywhere Kind is shown to a user
      (creation form, catalogue filter, Campaign page)

## Comments

- 2026-09-27 (ticket-writing): audited against the current tree —
  `prisma/schema.prisma`'s `Kind` enum already has `HIBAH`;
  `src/lib/campaign-kind.ts`'s `KINDS`/`KIND_LABEL`/`deadlineRequired` already
  include it; `src/lib/collecting-entity.ts`'s `requiresKindAuthorisation`
  is already `kind !== "DONATION"`, not an enumerated list. This ticket exists
  to close the gap between "the generic mechanism should cover this" and "a
  test proves it does" for Hibah specifically, per user stories 13–16.
