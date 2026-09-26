# 40: Changing a password must not weaken it

**What to build:** A user who changes their password ends up with a hash at least as strong as the one they registered with. Today registration hashes at cost 12 and a password change re-hashes at cost 10, so the act of rotating a password permanently downgrades that account — and it is the security-conscious user who rotates who gets weakened.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] One cost factor is defined in a single place and used by every path that hashes a password
- [ ] Registration and password change produce hashes of the same strength
- [ ] Accounts already downgraded to the weaker cost are re-hashed at the stronger cost on their next successful login, without asking the user to do anything
- [ ] A test proves a password change does not lower the cost factor of the stored hash
- [ ] Decide and record whether the shared factor is 12 or something else; ticket 41 changes what that number costs in latency, so the two interact

**Notes:** Both values date to the initial commit (`d9b9c54`), so no regression introduced this: it has always been this way. Measured locally with bcryptjs, cost 12 is roughly 4x the work of cost 10 (409ms vs 104ms per operation).

**Parent spec:** `.scratch/prd-compliance-fase-0-2/spec.md`
- 2026-09-25: Both cost factors now live in `src/lib/password-hash-cost.ts` (registration 12, password change 10, unchanged), and the routes read them from there (flaky-tests ticket 01). This ticket still has to choose the one factor and re-hash accounts that were weakened.
