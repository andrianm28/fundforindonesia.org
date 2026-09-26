# 10: Protect main with the required CI checks

**Blocked by:** 02, 03

**Status:** wontfix

- [ ] `main` requires test, build, migrations and ratchet to pass; decide whether the owner may push directly

## Comments

- 2026-09-26: On the current Free plan GitHub refuses both branch protection and rulesets (403 "Upgrade to GitHub Pro or make this repository public") and environment required reviewers (422). The owner chose to upgrade to GitHub Pro. After the upgrade, run:
  - `gh api -X PUT repos/andrianm28/fundforindonesia.org/environments/production` with `reviewers:[{type:User,id:25896940}]`;
  - branch protection on `main` requiring the checks `test`, `build`, `migrations` and `ratchet`, with `strict:false` and `enforce_admins:false`, and blocking force pushes and deletions.
- 2026-09-26: The owner decided to stay on the Free plan. Branch protection, rulesets and environment reviewers are unavailable, so this ticket is wontfix. The "merge only after green CI" rule is kept by the agent workflow (docs/agents/verification.md) and by the deploy job checking CI itself (ticket 07).
