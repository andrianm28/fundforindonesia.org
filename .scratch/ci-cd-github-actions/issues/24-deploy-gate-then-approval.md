# 24: deploy.yml runs the gate before asking for approval

**What to build:** Split `.github/workflows/deploy.yml` into two jobs:
- `gate`: no environment; the existing main-only check and `ci/deploy-gate.sh`.
- `deploy`: `environment: production`, `needs: gate`, the existing deploy steps.

Keep `workflow_dispatch`, the concurrency group `production` and every existing
safety check. Update `src/__tests__/workflows.test.ts` to pin the new shape
(gate has no environment; deploy has `environment: production` and
`needs: gate`; the deploy secrets are referenced only in the deploy job).

Update the dispatch policy in `docs/agents/verification.md` (Deploy section)
and `CLAUDE.md` (Sesi agent): agents, including the cloud coordinator, may
dispatch `deploy.yml` for a `main` commit with green CI once ticket 23's
environment exists; approval stays with the owner as environment reviewer; an
agent never approves its own deployment. Remove "agents never dispatch it" and
the "GitHub Free, no environment approvals / no branch protection" reasoning.

**Blocked by:** none (safe to merge before 23; until the environment exists the
deploy job would run unprotected, so nobody dispatches before 23 is done)

**Status:** done (PR #50, b361eed)

- [ ] `deploy.yml` has `gate` then `deploy` (`environment: production`, `needs: gate`); dispatch, main-only, gate script and concurrency unchanged
- [ ] `workflows.test.ts` pins the new shape; full suite and ratchet green
- [ ] verification.md and CLAUDE.md state the new policy; the old sentences are gone
