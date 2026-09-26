# 01: Delete the dead api-errors module

**What to build:** `src/lib/api-errors.ts` (178 lines) and its test (277 lines) have had no importers anywhere in `src` or `tests` since the initial commit. The architecture review of 2026-09-25 (candidate 6) found it fails the deletion test: removing it moves no complexity anywhere. Its `handlePrismaError` even maps P2003 to 400, which contradicts the 409 that the Campaign DELETE route actually answers, so it also misleads readers. Delete both files. The rest of candidate 6 (Campaign DELETE as a lifecycle command) stays open, pending the C11 decision.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] Both files are deleted, and nothing else in the repo referenced them (checked with grep, excluding generated code and worktrees)
- [ ] Full suite green (one test file fewer), and tsc adds no errors
