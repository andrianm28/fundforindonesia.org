# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

`.scratch/` is gitignored: specs and tickets are local scratch, the same way
`.superpowers/` already is. Implementation plans are the exception and are
committed (see below).

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation plans are written to `docs/superpowers/plans/`. No ADR in this
  repo decides a different location, so that default stands; it is recorded here
  because `/specflow:spec-to-plan` reads this line and passes it to
  `superpowers:writing-plans`, whose own default would otherwise win. Unlike the
  spec, plans are tracked in git.
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file. specflow tidak mengirim skill `triage`, jadi `docs/agents/triage-labels.md` tidak dibuat; pakai string status apa pun yang repo ini sudah pakai.
- This repo's status vocabulary, established during the Ledger Line ticket set: `ready-for-agent` (open, not yet started or in progress) and `done` (merged to `main`) -- update a ticket's `Status:` line to `done` once its branch merges, so the file doesn't go stale against the real git history. Do not invent a third status without a real need.
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## What is not the issue tracker

- **`.kiro/specs/<name>/{requirements,design,tasks}.md`** — three completed specs
  (`kitabisa-clone`, `platform-polish`, `user-roles`) from an earlier Kiro
  workflow. Every task in them is checked off. They are committed history worth
  reading for background, not an open queue: don't add work there and don't
  treat an unfinished-looking item there as live.
- **GitHub Issues** on `andrianm28/fundforindonesia.org` — not used for this
  workflow. The handoff to Superpowers needs the spec as a file path
  (`writing-plans` records `**Spec:** <path>` and the SDD controller reads it at
  setup), and an issue URL is not guaranteed to be fetched. If issues do get
  opened on GitHub, mirror the published spec to `.scratch/<feature-slug>/spec.md`
  and point the plan at the mirror.
- **`.superpowers/sdd/`** — gitignored SDD run ledger written during execution,
  not an intake surface.

## `/specflow:*` tooling removed (as of 2026-09-25)

The `specflow` plugin (which this file's own text above still references --
`/specflow:spec-to-plan`, `/specflow:to-spec`, etc., per `CLAUDE.md`'s
documented alur) is no longer installed: `~/.claude/skills/specflow` and its
plugin cache entry are both gone, replaced by the unwrapped `mattpocock-skills`
plugin (bare `grilling`, `domain-modeling`, `code-review`, `tdd`, etc. skills,
with no repo-specific issue-tracker mapping and no `check-plan-headings.sh`/
`check-seam-constraints.sh` guard scripts). Until `CLAUDE.md` and this file are
updated to reflect a real replacement workflow, treat the spec/plan process as:
`superpowers:writing-plans` directly (map a ticket's "What to build"/acceptance
criteria into the plan's Goal/Architecture/Global Constraints by hand, insert a
"Seam constraint (MENGIKAT task ini, dari spec)" block into every `### Task N`
block yourself), then verify heading structure manually by running
`task-brief <plan> <N>` for every task number and confirming a clean,
single-task extraction (this is what `check-plan-headings.sh` used to
automate) -- there is no automated guard to run instead.

## Fresh-worktree setup gap

`npm install` alone leaves a fresh worktree's test suite red: `src/generated/prisma`
(the generated Prisma client, imported as `@/generated/prisma/client` across the
codebase) is itself gitignored and worktree-local, and nothing runs `prisma
generate` automatically after install. Symptom: ~29 test files fail with
`Failed to resolve import "@/generated/prisma/client"`. Fix: run `npx prisma
generate` once per fresh worktree, right after `npm install`, before trusting any
red/green baseline result.
