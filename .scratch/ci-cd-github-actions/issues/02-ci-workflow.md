# 02: CI runs test, build and migrations on GitHub-hosted runners

**What to build:** `.github/workflows/ci.yml` with the test, build and migrations jobs from the spec. Push the branch and get it green. Prove that the migrations job fails on a throwaway branch with a schema/migration mismatch, then delete that branch.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] All three jobs pass on the pushed branch, and on `main` after merge
- [ ] The failing-migration proof is done, and the throwaway branch deleted
- [ ] Concurrency cancels superseded runs; npm is cached; no self-hosted runner
