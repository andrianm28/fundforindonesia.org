# 11: Hibah's document checklist mirrors Wakaf's

**What to build:** A `hibah` submission is checked against the same document
checklist a `wakaf` submission uses, so verification doesn't silently skip a
step no one has decided to skip.

**Blocked by:** cross-feature `prd-compliance-fase-0-2 12`
(verification-request; its own remaining scope note says per-Kind checklists
are still open, and as of this spec `VerificationChecklistItem` has no
`kind` column at all — the checklist is not per-Kind for any Kind yet)

**Status:** needs-info

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

- 2026-09-27 (needs-info): this ticket cannot be scoped tighter than "build
  per-Kind checklists, then seed hibah = wakaf's items" without a decision on
  how ticket 12's per-Kind checklist work gets sequenced against this feature
  — whether it lands as part of closing out ticket 12 itself (making this
  ticket redundant once 12 is fully done) or gets built here because 12 is
  otherwise idle. Whoever picks this up should check ticket 12's current
  status first and either fold this into it or confirm with the owner that
  building the per-Kind mechanism here, for `wakaf` and `hibah` at once, is
  the right split of work.
