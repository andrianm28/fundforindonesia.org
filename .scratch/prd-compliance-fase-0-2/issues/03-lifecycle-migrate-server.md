# 03: Campaign lifecycle: migrate API and money layer

**What to build:** Every server-side decision about whether a Campaign may be donated to, paid out, verified or suspended is made from the enum rather than a string comparison.

**Blocked by:** 2

**Status:** done

- [ ] API routes, the money layer and the moderation endpoints read the enum
- [ ] Only Active accepts a Donation, enforced in one place rather than repeated per route
- [ ] The old string is still written and still present; CI stays green throughout
- [ ] Existing route tests pass unchanged in intent, updated only where they asserted the string

## Comments

- 2026-09-26 (status tidy): Done through .scratch/campaign-status-transitions (C20) and .scratch/legacy-status-contract 01-02: every reader and writer uses the lifecycleStatus enum.
