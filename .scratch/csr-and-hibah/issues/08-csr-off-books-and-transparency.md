# 08: CSR money outside the books, shown as such everywhere

**What to build:** CSR money that never crossed the platform's account is
shown as a plain reported figure, unmistakably marked as outside the
platform's books, on the Program detail page and on Impact & Transparency —
never confused with money the ledger can account for.

**Blocked by:** 01, 07, and cross-feature `prd-compliance-fase-0-2 25`
(Impact & Transparency's six-line breakdown does not exist yet as of this
spec)

**Status:** in-review (PR #174)

- [ ] The Program detail page shows the off-books reported figure (ticket 01)
      next to, and visually distinct from, the ledger-backed Program Balance
      figure from ticket 07, with an explicit "outside the platform's books"
      label
- [ ] Impact & Transparency shows CSR money as its own line, split into
      "in the books" (from `PROGRAM_BALANCE`) and "outside the books" (the
      plain reported figures), matching FFI-14's transparency promise
- [ ] The "in the books" CSR line participates in whatever reconciliation
      Impact & Transparency's six-line breakdown enforces (ticket 25); the
      "outside the books" line explicitly does not, and is never added into a
      total that claims to reconcile against the ledger
- [ ] Regression: CSR money that never crossed the platform's account
      produces zero ledger entries and is visibly marked as outside the books
      everywhere it's reported (spec.md's named regression test)

## Comments

- 2026-09-27 (ticket-writing): blocked on `prd-compliance-fase-0-2 25`
  because that ticket defines the page's six-line reconciliation this must
  slot into without breaking it. If 25 lands first with a fixed six-line
  shape that has no obvious CSR slot, that's a question for whoever lands 25
  or the owner, not something to resolve unilaterally here.
