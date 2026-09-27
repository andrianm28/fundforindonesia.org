# 10: Suspended Hibah Campaign transfers within Kind, cross-Kind refused

**What to build:** A suspended `hibah` Campaign's funds move to another
Campaign of Kind `hibah`, never refunded to Donors, using the exact same
transfer mechanism the parent spec already builds for `zakat`/`wakaf` — no new
transfer logic.

**Blocked by:** cross-feature `prd-compliance-fase-0-2 33` (kind-transfer;
not built as of this spec)

**Status:** ready-for-agent

- [ ] A suspended `hibah` Campaign transfers its funds to another Campaign of
      Kind `hibah`, via the same balanced-journal, two-person-rule transfer
      ticket 33 builds
- [ ] A cross-Kind transfer out of or into a `hibah` Campaign is refused
      outright, not warned about — same as `zakat`/`wakaf`
- [ ] Every affected Donor Hibah is told where their money went
- [ ] Regression test named in the spec: a suspended `hibah` Campaign's
      transfer refuses a cross-Kind destination outright, matching the
      existing zakat/wakaf behaviour

## Comments

- 2026-09-27 (ticket-writing): do not start before `prd-compliance-fase-0-2
  33` lands. That ticket's own scope note says it's built because "the
  suspension rule cannot work without it" — this ticket just proves `hibah`
  reuses the same mechanism `wakaf`'s category-matching variant already
  establishes there.
