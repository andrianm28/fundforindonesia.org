# 09: Kind on Campaign

**What to build:** A Campaign declares whether it is donation, zakat or wakaf, and that choice starts driving its rules: whether a deadline is required, and which documents it will need.

**Blocked by:** None (can start immediately)

**Status:** done (PR #20, efca146)

- [ ] Campaign carries a Kind of donation, zakat or wakaf
- [ ] A deadline is mandatory except on Kind wakaf
- [ ] The creation form offers Kind, and the catalogue can filter by it
- [ ] Existing Campaigns are backfilled to donation
- [ ] Kind is immutable once a Campaign leaves Draft

## Comments

- 2026-09-26 (after merge), follow-ups from the agent:
  - The zakat page and `/api/zakat/campaigns` still filter by `category === 'zakat'`, not by Kind.
  - A deadline already in the past is not refused on create or submit.
  - Kind is fixed from Rejected onward: the owner confirmed this on 2026-09-26 (CONTEXT.md, PR #23).
  - UI copy says "Batas waktu" where CONTEXT.md says "tenggat".
