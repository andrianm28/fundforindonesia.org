# Handoff v1: coordinator continuation on main (2026-09-27)

Continuation of the v1-push handoff. The full coordinator doc lives on
`origin/claude/cool-shannon-t1rqdr` (PR #56, unmerged):
`.scratch/cloud-migration/handoff-v1.md` there (106 lines: how the
coordinator works, in-flight table, v1 ticket order, open questions).
Read that file first when #56 merges. This file records only what changed
since, verified from `main` in this session.

Workflow: `CLAUDE.md` (mattpocock-skills only, bare names). Intake
`/grill-with-docs` → spec `/to-spec` → `/to-tickets` if multi-session →
`/implement` per ticket (`/tdd`, close with `/code-review`). Debug
`/diagnosing-bugs`, intake `/triage`. Details in `docs/agents/`.

## Environment verification (this session, opencode on VPS, 2026-09-27)

- `node -v` → v22.23.2. `.nvmrc` says 24; cloud sessions get 24 via the
  SessionStart hook. Deviation noted, no action (VPS runs no builds).
- `node_modules/` absent on this checkout — expected (Phase 4 slim; VPS
  runs no suites). `src/generated/prisma/` present.
- opencode global config loads clean (`opencode debug config`):
  `skills.paths` → `/home/ubuntu/.agents/skills` (40 `SKILL.md`, names
  match folders), `instructions` → specflow `PRIORITY.md`, plugin
  superpowers. So `tdd`, `code-review`, `diagnosing-bugs`, `triage`, etc.
  resolve here by bare name.
- Vendored `.claude/skills/` intact (27 entries, `tdd/SKILL.md` ok) — that
  copy is for Claude Code cloud sessions, not this one.
- `gh` works (repo scope). Open PRs seen: #61, #59, #56 (drafts), #46, #14
  (dependabot).
- NOT run here, per `docs/agents/verification.md` (VPS: targeted tests
  only, never full suite/tsc/build): no `vitest`, no `tsc`, no
  `npm install`. CI stays the merge gate.

## Repo state (main `1109c46`, verified 2026-09-27)

- `git fetch --all --prune` + `git pull --ff-only`: main was already at
  `1109c46` (merge PR #60, middleware→proxy). 9 stale remote-tracking refs
  pruned on the earlier pull; nothing pruned this time.
- 9 tracking branches fast-forwarded, no local work lost:
  `ci-github-actions`, `ci-hardening`, `cicd-agent-workflow-docs`,
  `cicd-health-endpoint`, `cicd-image-ghcr`, `cicd-reconcile-kibi-clone`,
  `docs-partner-organisation`, `feat-vr-required-items`,
  `feat/escrow-release` (`26b9bc9` → `c794636`, was behind 8).
- Untouched on purpose: ~50 local-only `worktree-agent-*` branches (no
  remote counterpart; remove only after merge, per verification.md
  worktree hygiene) and feature branches with no upstream.
- Working tree clean, single worktree, on `main`.

## Suggested skills for the next session

- `triage`: PR #56/#57/#59/#61 merge queue + stale `ready-for-agent`
  re-check (handoff-cloud.md frontier).
- `tdd` + `code-review`: every ticket, via builders (sonnet; haiku for
  re-review; opus only for money/security/concurrency per CLAUDE.md).
- `diagnosing-bugs`: any CI red on the in-flight PRs.
- `resolving-merge-conflicts`: if `feat/escrow-release` (just moved 8
  commits) conflicts with main.
- `handoff`: next rotation (owner runs `/handoff`; sessions can't invoke it).
