# 02: CI fails when TypeScript or lint errors grow

**What to build:** A ratchet job. `ci/baselines.json` holds the current error counts: `tsc` 50 and `next lint` 169, re-measured at implementation time. A small Node script counts the errors, fails if either exceeds its baseline, and says to lower the baseline when a count falls. Prove it fails on a throwaway branch that adds one TS error, then delete that branch.

**Blocked by:** 01

**Status:** wontfix

- [ ] The ratchet job passes on `main` at the committed baselines
- [ ] One extra TS error on a throwaway branch fails the job, with a message naming the count and the baseline
- [ ] The script is tested with vitest on sample outputs, and the workflow runs it
