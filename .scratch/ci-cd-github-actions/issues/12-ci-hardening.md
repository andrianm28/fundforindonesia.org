# 12: Harden CI to current best practice, and move to Node 24 LTS

**What to build:** Findings from the 2026-09-26 best-practice audit of `.github/workflows/ci.yml`:
1. Pin every action to a full commit SHA, with a trailing version comment, at the current releases (checkout v7.0.1, setup-node v7.0.0).
2. Node version: one source of truth, `.nvmrc` = 24. Use it in CI (`node-version-file`) and in every Dockerfile stage (`node:24-alpine`), and set `engines.node` in package.json. Node 20 has been EOL since April 2026.
3. `concurrency.cancel-in-progress` is true only for pull requests. Every run on `main` completes, because it gates deploys.
4. `actions/checkout` uses `persist-credentials: false`.
5. `.github/dependabot.yml`: weekly updates for `github-actions` and `npm`, grouped, so pinned SHAs and dependencies stay current.
6. `npm ci` install scripts stay: Prisma needs its postinstall. This is a known risk, with the lockfile as the guard.

**Blocked by:** 02, 03

**Status:** done

- [ ] Every `uses:` is pinned to a 40-character SHA with a version comment
- [ ] CI and Dockerfile read Node 24 from one source; CI is green on Node 24 (test, build, migrations, ratchet)
- [ ] Only PR runs cancel superseded runs
- [ ] Dependabot covers actions and npm
