# 40: Changing a password must not weaken it

**What to build:** A user who changes their password ends up with a hash at least as strong as the one they registered with. Today registration hashes at cost 12 and a password change re-hashes at cost 10, so the act of rotating a password permanently downgrades that account — and it is the security-conscious user who rotates who gets weakened.

**Blocked by:** None (can start immediately)

**Status:** done (PR #90, sha 81a3053)

The sha is the commit carrying the change, `81a3053`. Other tickets record
their merge sha here instead; that one does not exist until the PR is merged,
so it gets filled in at merge time.

- [x] One cost factor is defined in a single place and used by every path that hashes a password
- [x] Registration and password change produce hashes of the same strength
- [x] Accounts already downgraded to the weaker cost are re-hashed at the stronger cost on their next successful login, without asking the user to do anything
- [x] A test proves a password change does not lower the cost factor of the stored hash
- [x] Decide and record whether the shared factor is 12 or something else; ticket 41 changes what that number costs in latency, so the two interact

**Notes:** Both values date to the initial commit (`d9b9c54`), so no regression introduced this: it has always been this way. Measured locally with bcryptjs, cost 12 is roughly 4x the work of cost 10 (409ms vs 104ms per operation).

**Parent spec:** `.scratch/prd-compliance-fase-0-2/spec.md`
- 2026-09-25: Both cost factors now live in `src/lib/password-hash-cost.ts` (registration 12, password change 10, unchanged), and the routes read them from there (flaky-tests ticket 01). This ticket still has to choose the one factor and re-hash accounts that were weakened.
- 2026-09-27: Decided 12, recorded in ADR 0017. The two constants collapsed into `PASSWORD_HASH_COST`; `isHashAtCurrentCost` reads the factor off the stored hash's `$2a$NN$` prefix, and the credentials provider's `authorize` re-hashes a weakened account on a successful login (best-effort, never on the request path). The guarding test uses real bcryptjs, since the defect is the number in the prefix; it read `expected 10 to be 12` before the fix.
- 2026-09-27: PR #46 (dependabot) bumped only `package.json` and `package-lock.json`; bcryptjs is untouched, so no hashing path appeared or changed there. The three production `bcrypt.hash` call sites are registration, password change, and the new login repair, plus the seed script.
