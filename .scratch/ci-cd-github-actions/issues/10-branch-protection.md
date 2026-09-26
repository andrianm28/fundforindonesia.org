# 10: Protect main with the required CI checks

**Blocked by:** 02, 03

**Status:** ready-for-human (reopened 2026-09-26: the repo is public, so GitHub Free allows branch protection)

- [ ] `main` requires the checks test, build, migrations, ratchet and image to pass before merge
- [ ] Force-push to `main` and deleting `main` are blocked
- [ ] Decided and recorded here: whether the owner may bypass (push directly)

Owner applies it in Settings → Branches → Add rule for `main`, or an agent does it through the API only after the owner explicitly allows that call. See `.scratch/ci-cd-github-actions/spec-production-environment.md`.

## Comments

- 2026-09-26: On the current Free plan GitHub refuses both branch protection and rulesets (403 "Upgrade to GitHub Pro or make this repository public") and environment required reviewers (422). The owner chose to upgrade to GitHub Pro. After the upgrade, run:
  - `gh api -X PUT repos/andrianm28/fundforindonesia.org/environments/production` with `reviewers:[{type:User,id:25896940}]`;
  - branch protection on `main` requiring the checks `test`, `build`, `migrations` and `ratchet`, with `strict:false` and `enforce_admins:false`, and blocking force pushes and deletions.
- 2026-09-26: The owner decided to stay on the Free plan. Branch protection, rulesets and environment reviewers are unavailable, so this ticket is wontfix. The "merge only after green CI" rule is kept by the agent workflow (docs/agents/verification.md) and by the deploy job checking CI itself (ticket 07).
