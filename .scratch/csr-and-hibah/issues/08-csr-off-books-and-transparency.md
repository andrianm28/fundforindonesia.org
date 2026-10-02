# 08: CSR money outside the books, shown as such everywhere

**What to build:** CSR money that never crossed the platform's account is
shown as a plain reported figure, unmistakably marked as outside the
platform's books, on the Program detail page and on Impact & Transparency —
never confused with money the ledger can account for.

**Blocked by:** 01, 07, and cross-feature `prd-compliance-fase-0-2 25`
(Impact & Transparency's six-line breakdown does not exist yet as of this
spec)

**Status:** awaiting-merge

- [x] The Program detail page shows the off-books reported figure (ticket 01)
      next to, and visually distinct from, the ledger-backed Program Balance
      figure from ticket 07, with an explicit "outside the platform's books"
      label
- [x] Impact & Transparency shows CSR money as its own line, split into
      "in the books" (from `PROGRAM_BALANCE`) and "outside the books" (the
      plain reported figures), matching FFI-14's transparency promise
- [x] The "in the books" CSR line participates in whatever reconciliation
      Impact & Transparency's six-line breakdown enforces (ticket 25); the
      "outside the books" line explicitly does not, and is never added into a
      total that claims to reconcile against the ledger
- [x] Regression: CSR money that never crossed the platform's account
      produces zero ledger entries and is visibly marked as outside the books
      everywhere it's reported (spec.md's named regression test)

## Comments

- 2026-09-27 (ticket-writing): blocked on `prd-compliance-fase-0-2 25`
  because that ticket defines the page's six-line reconciliation this must
  slot into without breaking it. If 25 lands first with a fixed six-line
  shape that has no obvious CSR slot, that's a question for whoever lands 25
  or the owner, not something to resolve unilaterally here.

- 2026-10-02 (csr-08, owner decisions): CSR is a separate block on `/impact`
  with its own reconciliation (every PROGRAM_BALANCE entry must carry a
  Manual Contribution, else the page refuses like the six lines), two lines
  "di dalam pembukuan" / "di luar pembukuan", never summed, not a seventh
  line, not in `collected`. `reportedNote` is NOT public: only amount and
  "per" date. `GET /api/impact` carries `csr` aggregates only (no per-Program
  figures); the Program page reads both figures via
  `src/lib/program-money.ts`.

- 2026-10-02: awaiting-merge. PR #182, commit 89205f1. Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.
