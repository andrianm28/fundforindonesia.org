# 14: Duplicate Campaign hints

**What to build:** A Verifier reviewing a Campaign is shown the handful of existing Campaigns it most resembles, so duplicates and repeat fraud are caught before publication rather than after.

**Blocked by:** 12

**Status:** needs-info (no trigram index or hints API yet; matching rule and scope need a decision first)

- [ ] At most five hints, matched on same Fundraiser, title similarity, or identical beneficiary name
- [ ] Title similarity uses the Postgres trigram extension, enabled by migration
- [ ] The similarity threshold defaults to 0.6 and is Admin-configurable
- [ ] The checklist carries an explicit 'not a duplicate' item
