# 14: Duplicate Campaign hints

**What to build:** A Verifier reviewing a Campaign is shown the handful of existing Campaigns it most resembles, so duplicates and repeat fraud are caught before publication rather than after.

**Blocked by:** 12

**Status:** done (PR #78, 1535b37)

- [ ] At most five hints, matched on same Fundraiser, title similarity, or identical beneficiary name
- [ ] Title similarity uses the Postgres trigram extension, enabled by migration
- [ ] The similarity threshold defaults to 0.6 and is Admin-configurable
- [ ] The checklist carries an explicit 'not a duplicate' item

## Comments

- 2026-09-27 (needs-info resolved): owner confirmed the trigram spec as written. Blocker 12 is ready-for-agent and unblocked (05 done).
- 2026-09-27 (implemented, PR #78): `src/lib/duplicate-hints.ts` holds the seam; the migration enables `pg_trgm` with `CREATE EXTENSION IF NOT EXISTS`, so a database that already has it is left alone and one that has never heard of it gets it created, while a role that may not create extensions fails the migration loudly at deploy time instead of the Verifier's page failing at runtime. Two calls the owner may want to see: `Campaign.beneficiaryName` is a new nullable plaintext column (ADR 0012), because the third match had no data to match on, and the "bukan duplikat" item is seeded as an ordinary general checklist row rather than added in code, so it reaches a request the way every other item does.
