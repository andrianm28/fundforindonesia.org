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
gh pr checks --watch               # blocks until every job finishes
gh run view <run-id> --log-failed  # logs of the failing steps only
```

When a job fails, read its log, fix the cause, push again, and watch again.
The run ID is in the check URL that `gh pr checks` prints, or in `gh run list
--branch <feature-branch>`. Mark the PR ready (`gh pr ready`) when the work is
done and CI is green.

## What each CI job proves

`.github/workflows/ci.yml` runs four jobs in parallel on every PR and push to
`main`:

- **test**: the full vitest suite passes. This is the full-suite step of
  `/implement`.
- **build**: `next build` succeeds with placeholder env.
- **migrations**: every migration applies to an empty Postgres 16, and
  `prisma migrate diff` against `prisma/schema.prisma` is empty afterwards. A
  schema change without a matching migration fails here. Fix it by adding or
  correcting the migration, never by editing an applied one.
- **ratchet**: the `tsc` and lint error counts are at or below
  `ci/baselines.json`. The repo carries old errors; the ratchet only lets the
  count fall. When the job reports a count below the baseline, lower
  `ci/baselines.json` to that count in the same PR, so the gain is locked in.
  When it reports a count above, fix the new errors. Raising a baseline
  hides new errors, so the baselines only ever go down.

## Merge and deploy

Merge to `main` only when every job is green.

Production deploys only through the approved CD job: the `deploy` job, gated
by the GitHub Environment `production`, which the owner approves per deploy.
That job is still being built (`cd.yml` and `ops/deploy.sh` are later tickets
of `.scratch/ci-cd-github-actions/`). Until it lands, deploying is the owner's
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

Run `git fetch origin` first so `origin/main` is current. If `remove` refuses
because of uncommitted or untracked files, stop and report them; `--force`
would destroy someone's unsaved work.
