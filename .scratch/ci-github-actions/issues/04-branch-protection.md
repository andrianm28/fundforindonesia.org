# 04: Protect main with required CI checks

**What to build:** In the GitHub repository settings, require the CI jobs (test, build, migrations, and the ratchet from ticket 02) to pass before merging to `main`. Do this once the workflow has been green on `main` for a few runs.

**Blocked by:** 01, 02

**Status:** wontfix

- [ ] A branch protection rule (or ruleset) on `main` requires the CI checks
- [ ] Decide whether direct pushes to `main` stay allowed for the owner
