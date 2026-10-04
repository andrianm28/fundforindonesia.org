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

### The one exception: a throwaway Postgres to develop a migration test

Standing a `postgres:16-alpine` container up once, to **write** a test that
applies a migration to a database that already holds rows, is allowed here.
Tear the container down when the test passes, and say so in the PR body.

This is the narrow exception, and it exists because the alternative was
shipped once and it was worse than useless. PR #82's guard counted rows per
`transactionId` and raised on anything `> 1` — which is **every** correct
ledger, since `assertBalanced` forbids a single leg. The migration could not
apply to any database holding one row. It passed CI because the `migrations`
job migrates an empty database, and its own test asserted the guard with a
**regex over the SQL text**, so nothing ever ran the SQL. A migration that
cannot apply to a populated database is a deploy-time failure with no test
that would have caught it.

So: a migration's behaviour is a property of a database, and testing it
without a database is not a weaker test, it is a different thing that
happens to be green. Write the test against a real one.

Two things keep this honest. The container is for *developing* the test; CI
runs it, on a runner that is not this host, through a separate
`LEDGER_CLAIM_TEST_DATABASE_URL` rather than the app's own `DATABASE_URL`.
And the test must `skipIf` that variable is unset and print that it is being
**skipped, not passing** — otherwise the skip is just a green check that
lies. Every other Docker prohibition on this host stands.

### The same failure, in the text an agent writes

The exception above is a green check that lies. A commit message that lies is
the same failure in prose, and every job in CI passes it, because CI reads the
tree and not the text.

On 2026-09-28 a pass over recent commit messages found three claims that were
false on the tree they described. `ef4a8a2` says `payoutCompletedLegs` "is
called at payouts.ts:484 -- verified in this change, not assumed"; in that
commit 484 is a blank line, and the call is at 513. The same commit says
`verifiedAt` "is read at two places", twenty minutes after `a043455` had added a
third. `fc2d256` pins "twelve" near-misses; the table holds eleven, and the
mutation said to turn "eleven of the twelve" red turns two.

None of these is a lint. Each is checkable by a reader holding the tree.

1. **Name a symbol and a path, not a line number.** `payouts.ts` and
   `payoutCompletedLegs` stay true. `payouts.ts:484` is a claim about a tree,
   and it stops being true at the next commit that touches the file — so by the
   time CI reads the message, the number is stale in a way nobody can see. A
   `commit-msg` job that resolved the path and checked the line would report
   the already-shifted truth as a failure on a correct claim, which is the same
   failure inverted. When the number is the point, as in quoting a bug to
   someone about to debug it, give the sha as well.
2. **A claim of verification carries the command that repeats it.** "Verified by
   mutating the gate to a prefix match" is not reproducible: nobody re-ran it,
   and re-running it contradicts the sentence above it. Write the command, not
   the conclusion. `rg -n 'payoutCompletedLegs' src/` is forty characters;
   "eleven of the twelve go red" is a number with nothing behind it.
3. **A claim about the state before the change names the tree it means.** "Still
   says no scheduler" is true of a tree, and trees here move under the
   sentence. Say which commit or which base, or write it as a condition rather
   than a fact.

Rule 1 only holds if someone reads it. Nothing in this repo enforces it, and
nothing will; that is the same bargain as the rest of this file. What changed on
2026-09-28 is only that the failure is named.

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
  `/implement`. The suite runs as three parallel shards (`test-shard (i/3)`,
  each with its own Postgres); the check named exactly `test` is an aggregate
  that needs all three and fails if any did not succeed. Branch protection
  and `ci/deploy-gate.sh` match that name, so never rename it.
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

`.github/workflows/cd.yml` adds one more job. On a PR it runs only when the
Dockerfile, `.dockerignore`, `package.json`, `package-lock.json`, `prisma/`,
`prisma.config.ts`, `next.config.mjs`, `.trivyignore` or a workflow changes;
otherwise `image` is skipped and shows as skipped, which counts as passing
(decided by the small `image scope` job, not a workflow `paths:` filter, which
would leave the check missing). Every push to `main` always builds it:

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
environment's required reviewer. Three controls apply together (owner's
decision 2026-10-04, ticket ci-cd 25, "A + reviewer + protection"): only the
owner dispatches `deploy.yml`; the owner is also the only required reviewer of
environment `production`; and `main` has branch protection (required checks
test, build, migrations, ratchet, e2e; no force-push or deletion). Agents,
including the cloud coordinator, never dispatch the workflow and never approve
a deployment.
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
