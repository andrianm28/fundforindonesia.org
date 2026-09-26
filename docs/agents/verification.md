# Verification: prove the change before and in CI

Agent sessions for this repo run in **Claude Code cloud sessions**, not on the
VPS. The VPS (103.92.214.243) serves production and other stacks; heavy checks
from agents once pushed its load to about 22 on 8 cores and filled its disk.
CI on GitHub Actions stays the merge gate either way.

## In a cloud session (the default)

The container (4 vCPU, 16 GB) is yours alone. The SessionStart hook
(`.claude/hooks/session-start.sh`) runs `npm install` and `npx prisma
generate`. Before pushing, run what CI will run:

```sh
npx vitest run                 # full suite
npx tsc --noEmit | grep -c 'error TS'   # compare with ci/baselines.json
npx next lint
```

`next build`, Docker, and a throwaway Postgres (pre-installed, start it with
`service postgresql start`) are allowed when the change needs them, for
example to try a migration. Cloud sessions never reach the production host:
no SSH, and deploys stay the owner's dispatch (below).

## On the VPS (emergencies and owner-run ops only)

If you do run on the VPS, run only the test files that cover your change:

```sh
npx vitest run src/__tests__/foo.test.ts src/lib/bar.test.ts
```

No full suite, project-wide `tsc`, `next build`, `docker build` or throwaway
Docker Postgres there: push and let CI run them. In a fresh worktree, run
`npx prisma generate` once after `npm install` (see
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
  targets), the run summary reports both image sizes, sharp loads and encodes
  an image inside the app image, the migrate image migrates an empty Postgres,
  the app image answers 200 on `/api/health`, and Trivy finds no CRITICAL fixable
  vulnerability or secret in either image. On PRs nothing is pushed. After CI
  passes on `main`, the same job pushes the images to GHCR. A finding that
  cannot be fixed yet goes in `.trivyignore` with a reason and an expiry date.

## Merge and deploy

Merge to `main` only when every job is green.

Production deploys only through `.github/workflows/deploy.yml`, which the
owner starts by hand (`workflow_dispatch`, from main, with an optional commit
SHA): the repo stays on GitHub Free, where environment approvals and branch
protection are unavailable, so dispatching it is the approval. Before it
touches the host, the job (`ci/deploy-gate.sh`) refuses any commit that is not
on main, has no green CI push run with all four jobs, or lacks cd.yml's app
and migrate images in GHCR with matching provenance. It then SSHes to the
host's forced command with the SHA and the two image digests, and
`ops/deploy.sh` does the rest. Rolling back is the same dispatch with an older
SHA. When a release changes `ops/deploy.sh` or `docker-compose.prod.yml`, the
owner copies them to the host first: the deploy key cannot write files.

Agents never dispatch it, and never run `ops/deploy.sh` on the host
themselves: it switches production. Its tests stub `docker` and `curl`, and
the gate's tests stub `gh` and `curl`. Leave the running
production stack alone: no `docker compose` against it, no manual deploy
scripts from the host, and nothing inside `/home/ubuntu/kibi-clone`, which is the live production checkout.

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
