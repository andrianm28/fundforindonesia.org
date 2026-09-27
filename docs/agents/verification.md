# Verification: prove the change before and in CI

Agent sessions for this repo run in **Claude Code cloud sessions**, not on the
VPS. The VPS serves production and other stacks; heavy checks
from agents once pushed its load to about 22 on 8 cores and filled its disk.
CI on GitHub Actions stays the merge gate either way.

## In a cloud session (the default)

The container (4 vCPU, 16 GB) is yours alone; its setup is in
[cloud-environment.md](cloud-environment.md). The SessionStart hook
(`.claude/hooks/session-start.sh`) puts Node 24 on `PATH`, runs `npm ci` and `npx prisma
generate`. Before pushing, run what CI will run. `npm run ci:local` runs the four CI jobs
(test, build, migrations against a throwaway local Postgres, ratchet) in CI's
order; pass job names to run a subset (`npm run ci:local -- test ratchet`). By hand:

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

`.github/workflows/ci.yml` runs five jobs in parallel on every PR against
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
- **e2e**: Playwright drives the production bundle (`next start`) against a
  throwaway Postgres: the privileged not-found view, the QRIS donation path
  through Receipt, and the pre-existing main flows. Fixtures come from
  `tests/e2e/seed-e2e.ts`; answers that need no login are stubbed at the
  network edge inside the specs, which say so. The deploy gate only names
  the first four jobs, so this one gates deploys through the run's overall
  success instead.

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

Production deploys only through `.github/workflows/deploy.yml`
(`workflow_dispatch`, from main, with an optional commit SHA), split into two
jobs. `gate` runs first, with no Environment: it refuses any commit that is
not on main, has no green CI push run with all four jobs it names (test,
build, migrations, ratchet; the e2e job gates through the run's overall
success instead), or lacks cd.yml's
app and migrate images in GHCR with matching provenance
(`ci/deploy-gate.sh`). `deploy` runs `needs: gate`, in the `production`
Environment, so it starts only once the owner approves it as that
environment's required reviewer. Agents, including the cloud coordinator, may
dispatch the workflow for a green-CI commit on main once environment
`production` exists (ticket 23); an agent never approves its own deployment.
Once approved, `deploy` SSHes to the host's forced command with the SHA and
the two image digests, and `ops/deploy.sh` does the rest. Rolling back is the
same dispatch with an older SHA. When a release changes `ops/deploy.sh` or
`docker-compose.prod.yml`, the owner copies them to the host first: the
deploy key cannot write files.

Agents never run `ops/deploy.sh` on the host themselves: it switches
production. Its tests stub `docker` and `curl`, and the gate's tests stub
`gh` and `curl`. Leave the running production stack alone: no
`docker compose` against it, no manual deploy scripts from the host, and
nothing inside `/home/ubuntu/kibi-clone`, which is the live production
checkout.

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

### Merge from the newest base, every time

Before merging a long-lived branch, merge the current `origin/main` into it
and re-run the checks. A branch that was green days ago is not green now, and
the failure lands on `main` rather than on the branch:

- A branch carrying an older `ci/baselines.json` will put `main` above its own
  baseline, turning the ratchet red. The count is a property of the *merged*
  tree, not a sum across branches: each branch can be under the baseline on
  its own and the union above it.
- The ratchet is not the only thing. Every fix another branch merged — a
  removed import, a renamed route segment — is missing from yours, so merging
  it can put `main` back below a baseline it had already satisfied.

`gh pr merge` reporting `CONFLICTING`, or a branch whose `git merge-base
--is-ancestor origin/main <branch>` fails, is the cheap signal. Act on it
before merging anything, not after `main` is red.
