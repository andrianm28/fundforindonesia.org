# 11: Hibah's document checklist mirrors Wakaf's

**What to build:** A `hibah` submission is checked against the same document
checklist a `wakaf` submission uses, so verification doesn't silently skip a
step no one has decided to skip.

**Blocked by:** cross-feature `prd-compliance-fase-0-2 12`
(verification-request; its own remaining scope note says per-Kind checklists
are still open, and as of this spec `VerificationChecklistItem` has no
`kind` column at all — the checklist is not per-Kind for any Kind yet)

**Status:** ready-for-agent (sequencing decided 2026-09-27: per-Kind mechanism rides in prd-12; this ticket seeds hibah = wakaf's items after 12 is done)

- [ ] `VerificationChecklistItem` (or its replacement) is scoped per Kind,
      built as the general per-Kind mechanism ticket 12 already owes
      `zakat`/`wakaf`, not a `hibah`-only special case
- [ ] `hibah`'s checklist starts out identical to `wakaf`'s current checklist
      items
- [ ] The Admin checklist editor lets an Admin later diverge `hibah`'s
      checklist from `wakaf`'s without touching `wakaf`'s own items
- [ ] A `hibah` Verification Request is checked against `hibah`'s checklist,
      not `wakaf`'s, at submission time (even though the content starts equal)

## Comments

- 2026-09-27 (needs-info resolved): owner chose "lipat ke tiket 12" — the per-Kind checklist mechanism is built in prd-compliance-12 (ready, unblocked); this ticket then seeds hibah's items identical to wakaf's. Do not dispatch before 12 is done.
