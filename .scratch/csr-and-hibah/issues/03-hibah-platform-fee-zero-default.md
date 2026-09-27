# 03: Hibah's default Platform Fee is zero

**What to build:** A regression test proving a `hibah` Campaign's Platform Fee
resolves to zero until an Admin deliberately sets a rate for it — matching
`zakat`/`wakaf`.

**Blocked by:** None (`resolvePlatformFeeBasis` in
`src/lib/money/platform-fee-config.ts` already resolves to `0` when no
Campaign, Category, or Kind rule has been set — this is structural, not a
`hibah`-specific case to add)

**Status:** ready-for-agent

- [ ] With no `PlatformFeeRule` row for Kind `hibah`, Category, or the
      Campaign, `resolvePlatformFeeBasisForCampaign` returns `percentBps: 0`
      for a `hibah` Campaign
- [ ] An Admin can set a `KIND` rule for `hibah` the same way they can for
      any other Kind (`setPlatformFeeRule`), and it takes effect only for
      Donations made afterwards, same as every other Kind
- [ ] The rate shown on a `hibah` Campaign's page matches what
      `resolvePlatformFeeBasisForCampaign` resolves

## Comments

- 2026-09-27 (ticket-writing): no code change is expected for the default
  itself — `resolvePlatformFeeBasis` (ticket 17, done) already has no
  per-Kind default table to add `hibah` to; the "default zero" behaviour
  falls out of "no rule set resolves to 0". If review finds otherwise (e.g. a
  seed migration that pre-sets non-zero Kind rules for `zakat`/`wakaf`), flag
  it here rather than silently adding a `hibah` case that doesn't match.
