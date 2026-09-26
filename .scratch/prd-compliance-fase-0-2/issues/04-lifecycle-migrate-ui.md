# 04: Campaign lifecycle: migrate pages and components

**What to build:** The catalogue, Campaign detail, dashboards and the Verifier panel all display and filter Campaign Status from the enum, so a visitor sees the same lifecycle the server enforces.

**Blocked by:** 2

**Status:** done

- [ ] Catalogue, search, explore, Campaign detail, account pages, admin and moderation read the enum
- [ ] Suspended and Cancelled render distinctly, so a Fundraiser who withdrew honestly is not shown like one who was frozen
- [ ] The old string is still present; CI stays green

## Comments

- 2026-09-26 (status tidy): Done through .scratch/campaign-status-transitions (C20) and .scratch/legacy-status-contract 01-02: every reader and writer uses the lifecycleStatus enum.
