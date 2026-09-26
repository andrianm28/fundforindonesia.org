# Verification: CI proves the change, not the host

This checkout lives on the shared production host (103.92.214.243). It serves
production and other stacks, and several agents often work on it at once. Heavy
checks from agents pushed its load to about 22 on 8 cores and filled its disk
with Docker build cache. GitHub Actions runs the heavy checks instead.

## Locally: only the tests your change touches

Run the test files that cover your change, and nothing wider:

```sh
npx vitest run src/__tests__/foo.test.ts src/lib/bar.test.ts
```

That is enough for `/tdd`'s red-green loop. For the full suite, project-wide
`tsc`, `next build`, `docker build` or a throwaway Docker Postgres, push and let
CI run them. Keep them off the host even as a "quick check": each one costs
minutes of CPU on a machine serving production.

In a fresh worktree, run `npx prisma generate` once after `npm install` (see
[issue-tracker.md](issue-tracker.md#fresh-worktree-setup-gap)).

## Push, open a PR, watch CI

```sh
git push -u origin <feature-branch>
gh pr create --draft --base main   # draft while you are still working
gh pr checks --watch               # blocks until every job finishes (or: gh run watch <run-id>)
gh run view <run-id> --log-failed  # logs of the failing steps only
```

When a job fails, read its log, fix the cause, push again, and watch again.
The run ID is in the check URL that `gh pr checks` prints, or in `gh run list
--branch <feature-branch>`. Mark the PR ready (`gh pr ready`) when the work is
done and CI is green.

## What each CI job proves

`.github/workflows/ci.yml` runs four jobs in parallel on every PR against
`main` and every push to `main`:

- **test**: the full vitest suite passes. This is the full-suite step of
  `/implement`.
- **build**: `next build` succeeds with placeholder env.
- **migrations**: every migration applies to an empty Postgres 16, and
  `prisma migrate diff` against `prisma/schema.prisma` is empty afterwards. A
  schema change without a matching migration fails here. Fix it by adding or
  correcting the migration, never by editing an applied one.
- **ratchet**: the `tsc` and lint error counts are at or below
  `ci/baselines.json`. The repo carries old errors, and the baselines only ever
  go down: raising one hides new errors. When the job fails, fix the new
  errors. When you fixed errors, the job stays green, so read its log (`gh run
  view --log --job <job-id>`, the ID ending the ratchet URL in `gh pr checks`); if it says a count is below the
  baseline, lower `ci/baselines.json` to that count in the same PR, so the gain
  is locked in.

`.github/workflows/cd.yml` adds one more job on every PR:

- **image**: the production Docker image builds (the `runner` and `migrate`
  targets), the migrate image migrates an empty Postgres, the app image
  answers 200 on `/api/health`, and Trivy finds no CRITICAL fixable
  vulnerability or secret in either image. On PRs nothing is pushed. After CI
  passes on `main`, the same job pushes the images to GHCR. A finding that
  cannot be fixed yet goes in `.trivyignore` with a reason and an expiry date.

## Merge and deploy

Merge to `main` only when every job is green.

Production deploys only through the CD `deploy` job, which the owner starts
by hand (`workflow_dispatch`): the repo stays on GitHub Free, where
environment approvals and branch protection are unavailable, so dispatching it
is the approval, and the job itself refuses any commit whose CI run is not
green. Agents never dispatch it. That job is still being built (`ops/deploy.sh`
and the deploy job are later tickets of `.scratch/ci-cd-github-actions/`). Until it lands, deploying is the owner's
call, not an agent's. Leave the running production stack alone: no
`docker compose` against it, no manual deploy scripts from the host, and
nothing inside `/home/ubuntu/kibi-clone`, which is the live production checkout.

## Worktree hygiene

Agent worktrees live under `.claude/worktrees/` and are locked while in use.
Remove one only after its branch has merged:

```sh
git merge-base --is-ancestor <worktree-HEAD> origin/main && \
  git worktree unlock <path> && git worktree remove <path>
```

Run `git fetch origin` first so `origin/main` is current. PRs here land as
merge commits, so a merged HEAD is an ancestor of `origin/main`; if the check
fails, treat the worktree as unmerged and leave it. If `remove` refuses
because of uncommitted or untracked files, stop and report them; `--force`
would destroy someone's unsaved work.
