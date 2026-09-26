# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

`.scratch/` is **committed**, so cloud sessions can read and update it. A
ticket's status change and its Comments ride in the same PR as the work they
describe; planning-only changes (new specs, triage) go in their own small PR.
Never put credentials in it: the repo is private, but `.scratch` is shared with
every session and every collaborator.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings, including this repo's closing status `done`)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

## What is not the issue tracker

- **`.kiro/specs/<name>/{requirements,design,tasks}.md`** — three completed specs
  (`kitabisa-clone`, `platform-polish`, `user-roles`) from an earlier Kiro
  workflow. Every task in them is checked off. They are committed history worth
  reading for background, not an open queue: don't add work there and don't
  treat an unfinished-looking item there as live.
- **GitHub Issues** on `andrianm28/fundforindonesia.org` — not used for this
  workflow. If issues do get opened on GitHub, mirror the spec to
  `.scratch/<feature-slug>/spec.md` so the skills can read it as a file.
- **`.superpowers/sdd/`** and **`docs/superpowers/plans/`** — artefacts of the
  earlier specflow + Superpowers workflow, which this repo no longer uses (only
  `mattpocock-skills`). History, not an intake surface: don't write new plans
  there.

## Fresh-worktree setup gap

`npm install` alone leaves a fresh worktree's test suite red: `src/generated/prisma`
(the generated Prisma client, imported as `@/generated/prisma/client` across the
codebase) is itself gitignored and worktree-local, and nothing runs `prisma
generate` automatically after install. Symptom: ~29 test files fail with
`Failed to resolve import "@/generated/prisma/client"`. Fix: run `npx prisma
generate` once per fresh worktree, right after `npm install`, before trusting any
red/green baseline result.
