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

## Fresh-worktree setup gap

`npm install` alone leaves a fresh worktree's test suite red: `src/generated/prisma`
(the generated Prisma client, imported as `@/generated/prisma/client` across the
codebase) is itself gitignored and worktree-local, and nothing runs `prisma
generate` automatically after install. Symptom: ~29 test files fail with
`Failed to resolve import "@/generated/prisma/client"`. Fix: run `npx prisma
generate` once per fresh worktree, right after `npm install`, before trusting any
red/green baseline result.
