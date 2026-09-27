# 14: Duplicate Campaign hints

**What to build:** A Verifier reviewing a Campaign is shown the handful of existing Campaigns it most resembles, so duplicates and repeat fraud are caught before publication rather than after.

**Blocked by:** 12

**Status:** ready-for-agent (trigram spec confirmed 2026-09-27)

- [ ] At most five hints, matched on same Fundraiser, title similarity, or identical beneficiary name
- [ ] Title similarity uses the Postgres trigram extension, enabled by migration
- [ ] The similarity threshold defaults to 0.6 and is Admin-configurable
- [ ] The checklist carries an explicit 'not a duplicate' item

## Comments

- 2026-09-27 (needs-info resolved): owner confirmed the trigram spec as written. Blocker 12 is ready-for-agent and unblocked (05 done).
