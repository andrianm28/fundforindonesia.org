# 01: CI runs tests, build and migrations on GitHub-hosted runners

**What to build:** `.github/workflows/ci.yml` on `ubuntu-latest`. It is triggered by pushes to `main`, pull requests to `main`, and manual dispatch, with superseded runs cancelled. It has three parallel jobs, **test**, **build** and **migrations**, as described in `.scratch/ci-github-actions/spec.md`. Verify it by pushing the branch and watching the runs go green, and prove that the migrations job fails on a deliberately broken migration on a throwaway branch.

**Blocked by:** None (can start immediately)

**Status:** wontfix

- [ ] A push of the feature branch triggers the workflow (via PR or a branch run), and all three jobs pass
- [ ] Migrations job: `migrate deploy` into Postgres 16 plus an empty `migrate diff`. A throwaway branch with a schema/migration mismatch makes it fail, and the branch is deleted afterwards
- [ ] Concurrency cancels a superseded run; npm is cached
- [ ] No self-hosted runner and no secrets are needed
