# 09: Hibah refund carve-out matches Zakat/Wakaf

**What to build:** A Refund on a `hibah` Payment is refused for an ordinary
request and permitted only for wrong payment, double payment, or funds
arriving after Campaign closure — the same carve-out Zakat and Wakaf get.

**Blocked by:** cross-feature `prd-compliance-fase-0-2 31`
(refund-gross-ledger; as of this spec's writing, `src/lib/money/refunds.ts`
has no per-Kind logic at all yet — this rule doesn't exist for
`zakat`/`wakaf` either)

**Status:** done
`src/lib/money/refunds.ts:137-152` (Hibah uses Zakat/Wakaf rules, commit fc2d256)

- [ ] Per ADR 0013's data-driven instruction: the per-Kind refund rule is
      implemented as a rule table or equivalent (not a one-off `if kind ===
      'hibah'`), and `hibah` reads the exact same rule `zakat`/`wakaf` read —
      if the precedent ticket 31 lands as a hardcoded per-Kind check instead
      of a table, `hibah` matches that same shape for consistency rather than
      inventing a new pattern here
- [ ] An ordinary "I changed my mind" refund request on a `hibah` Payment is
      refused
- [ ] A refund is permitted on a `hibah` Payment for: wrong payment, double
      payment, or funds arriving after Campaign closure
- [ ] Regression test named in the spec: a Refund on a `hibah` Payment is
      refused for an ordinary request and permitted only for the
      technical-failure carve-out

## Comments

- 2026-09-27 (ticket-writing): do not start before `prd-compliance-fase-0-2
  31` lands — there is no per-Kind refund gate yet to add a `hibah` case to.
