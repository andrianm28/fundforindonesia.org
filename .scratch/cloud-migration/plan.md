# Plan: move the agent workspace from the VPS to Claude Code cloud sessions

Status: in progress. Phase 1 is PR #30. The owner decided on 2026-09-26: "ya, maksudnya pindahkan semua sesi claude project ini ke claude cloud"
Date: 2026-09-26

## Why

The VPS is shared with production: kibi-clone, Stalwart mail, nginx and the other stacks. Agent worktrees have pushed the load to about 22 on 8 cores and filled the disk (81% before today's cleanup). Each worktree is about 1 GB. The workarounds we adopted cost us verification:
- targeted tests only;
- no project-wide tsc;
- no docker;
- everything proven in CI.

A cloud session has 4 vCPU, 16 GB RAM, Docker and Postgres 16, and runs isolated from production.

## Facts (Claude Code docs, 2026-09-26)

- **How a session gets the repo:** `claude --cloud "<task>"`, or claude.ai/code, clones the GitHub remote at the **current branch**. The session's work comes back as a pushed branch or PR, and `--teleport` pulls a session into the local terminal.
- **Gitignored files don't reach the cloud.** Our issue tracker `.scratch/` is gitignored, so today no cloud session can see a spec or ticket.
- **User-scope plugins don't load in the cloud,** and `enabledPlugins` in the repo is not enough. Committed `.claude/skills/`, `.claude/agents/` and `.claude/commands/` do load. PR #3 installs the plugin from a SessionStart hook; whether the skills actually load after that is unproven.
- **User-level instructions stay behind.** `~/.claude/CLAUDE.md` (model tiering) and the auto-memory are not in the cloud. Only the repo's CLAUDE.md goes along.
- **What a session can use:**
  - `gh` is pre-authenticated, scoped to this repo;
  - network is a trusted allowlist;
  - env vars are visible to every user of the environment, so no secrets.
- **Docker and Postgres are installed but not started.** The session starts them itself. That means the full suite, project-wide tsc, `next build` and migrations against a throwaway Postgres are all possible there.
- **SSH out is undocumented,** since egress goes through an HTTP proxy. It is not needed anyway: the deploy is `deploy.yml`, dispatched by the owner.
- **Coordination:**
  - parallel `claude --cloud` sessions run independently;
  - follow-ups are fire-and-forget (`claude -p "…" --cloud <id>`);
  - a cloud session cannot SendMessage back.
  - This session's Agent tool offers `isolation: "remote"` (availability is gated and undocumented), so it has to be tried.

## Target shape

| Work | Where |
|---|---|
| Implementing tickets (tdd, code-review), full-suite and tsc verification | **Cloud sessions**, one per ticket |
| Orchestration: triage, merge, status updates, relaying decisions to the owner | **A cloud session too** (owner decision). It runs builders as subagents inside its container (max 3), or the owner opens one cloud session per ticket. |
| Grilling, specs, tickets | Any session, since the tracker lives in git |
| Production ops: nginx, cutover, kibi-clone, mail, host backups | **VPS only, owner-run** (ci-cd 08) |
| Deploy | `deploy.yml` dispatched by the owner (unchanged) |

## Phases

### Phase 1: make the repo self-contained for a cloud session (one PR)

1. **Move the issue tracker into git.**
   - Commit `.scratch/`: remove it from `.gitignore`, and delete the loose `*commit-msg*.txt`/`pr1-body.md` files first.
   - Update `docs/agents/issue-tracker.md`: "committed, one PR per status change", or status changes ride with the implementing PR.
   - The private repo holds no credentials; scanned 2026-09-26.
2. **Skills in the repo.** Either vendor `mattpocock-skills` into `.claude/skills/`, pinned at 1.2.3 (check the licence first), or keep the PR #3 hook install and prove it. See decision Q2.
3. **Merge PR #3.** It adds the SessionStart hook: `npm install`, `prisma generate`, and the plugin install that Q2 keeps or drops. Rebase it on main first.
4. **Move the model tiering and agent rules into the repo's CLAUDE.md** (or `docs/agents/`): the parts of `~/.claude/CLAUDE.md` and the memory that should apply to cloud sessions.
5. **Split `docs/agents/verification.md` by environment.**
   - In the cloud: the full suite, tsc, build, docker and a throwaway Postgres are allowed and expected before pushing.
   - On the VPS: the current host-load rules.
   - Everywhere: CI stays the merge gate.

### Phase 2: pilot

- Run **one** ready ticket as a cloud session, for example VR 09 or ci-cd 11 after triage. Do it both ways, `claude --cloud` and `Agent isolation: "remote"`. Check four things:
  - the skills load;
  - `.scratch` is readable;
  - the full suite passes in the session;
  - a draft PR opens and CI goes green.
- Also check how the result comes back to the coordinator: a PR plus polling `gh`, or a notification.

### Phase 3: switch the default

- New tickets go to cloud sessions, with at most 3–4 in parallel.
- VPS worktrees are used only for emergencies.
- Remove the `.claude/worktrees/` leftovers.
- Tell the `yiem-main-agent` session that the load is off the host.

### Phase 4: slim the VPS

- Remove the dev-only caches: `node_modules` in the main checkout, and the Docker build cache (~11 GB reported).
- Keep the main checkout only for ci-cd 08 and ops.
- The migration is done when for one week no agent build ran on the VPS and load/disk stayed at production-only levels.

## §4 Decisions for the owner

- **Q1.** How does the tracker get into git? Recommended: commit `.scratch/` as it is, so paths and skills keep working. The alternatives, `docs/issues/` or GitHub Issues, mean rewriting paths in every ticket.
- **Q2.** How do the skills reach the cloud? Recommended: vendor them into `.claude/skills/`, so they are deterministic and offline. The hook install depends on the network and is unproven. The cost of vendoring is manual updates.
- **Q3.** Where does the coordinator live? Recommended: stay on the VPS as one light session with no builds, because it needs `gh` for all PRs and the production-ops context. Alternative: the owner's laptop.
- **Q4.** Should `.scratch` status changes ride in the implementing PR or in separate direct commits to main? Recommended: in the implementing PR, which avoids a push to main for every status change.

## Decisions (2026-09-26)

- Q1: commit `.scratch/` as it is. Done in PR #30.
- Q2: vendor the skills into `.claude/skills/`. Done in PR #30.
  Superseded 2026-09-26 (owner): use the official Skills For Real Engineers
  plugin (ID `58da2c13-5ed4-4485-9625-fb87b369e6b4`), enabled on the claude.ai
  account and synced into cloud sessions. The vendored copy stays as a
  fallback until a fresh cloud session lists the plugin's skills, then goes.
- Q3: **every** session goes to the cloud, including the coordinator. That overrides the recommendation to keep it on the VPS.
- Q4: status changes ride in the implementing PR.

## Handover checklist for the first cloud coordinator session

- [ ] PR #30 is merged, and main CI is green.
- [ ] The owner opens a cloud session on this repo from `main`, at claude.ai/code or with `claude --cloud`.
- [ ] In that session:
  - the SessionStart hook passes;
  - `/tdd` and the other skills list under their bare names;
  - `cat .scratch/deploy-readiness.md` works;
  - `npx vitest run` passes;
  - `gh pr list` works.
- [ ] Start the pilot with one ready ticket (phase 2).
- [ ] The VPS session finishes the agents it already started (prd-compliance 11 and 17), merges their PRs, then stops taking work.
- [ ] Phase 4, owner-run on the VPS: remove the FFI dev caches (`node_modules` in the checkout, FFI-only images and build cache). Keep the checkout only for ci-cd 08.
  - **No host-wide prunes.** makam shares this Docker daemon (confirmed by makam-main-agent on 2026-09-26): `makam-staging`, `glitchtip`, `makam-nonprod-*`, `makam-testpg`, `~/.cache/makam/deps`, and up to 4 makam worktrees. Never run `docker system prune`, `docker builder prune -a` or `docker image prune -a`. Remove FFI images by name only (`fundforindonesia*`, old `kibi-clone-app` tags after the cutover). Clear build cache only with a filter that matches FFI builds, or leave it to the owner.
