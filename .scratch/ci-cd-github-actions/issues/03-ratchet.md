# 03: CI fails when TypeScript or lint errors grow

**What to build:** A ratchet job with `ci/baselines.json` (tsc and lint counts, measured at implementation time) and a small tested Node script. It fails when a count exceeds its baseline and asks for the baseline to be lowered when a count drops. Prove it fails on a throwaway branch that adds one TS error, then delete that branch.

**Blocked by:** 02

**Status:** done

- [ ] The ratchet passes on `main`, and one extra error fails it with a clear message
- [ ] The script is unit-tested
