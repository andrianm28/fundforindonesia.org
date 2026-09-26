# Spec: CI/CD on GitHub Actions, deploying production to this host

Status: ready-for-agent
Source: the user's requests of 2026-09-26 ("pindahkan CI build/test ke GitHub Actions hosted runner", then "setup complete CI/CD pipeline … target prod ke host ini"), and the `yiem-main-agent` report about load and Docker cache on the shared host (103.92.214.243). Decided in the grilling of 2026-09-26: CI Q1–Q6 and CD Q1–Q9. This spec supersedes `.scratch/ci-github-actions/`.

## Problem Statement

- **All verification runs on a shared host.** The full vitest suite, `tsc`, `next build` and throwaway Postgres checks all run here, often from four agents at once. This pushed the load average to about 22 on 8 cores.
- **Production also builds on the host.** It is built with `docker compose build`, leaving roughly 11 GB of build cache that needed three manual cleanups in a week.
- **Production doesn't deploy from this repo.** It runs from `/home/ubuntu/kibi-clone`, a checkout of `github.com/andrianm28/kibi-clone` whose `main` (`0045c62`) has commits this repo lacks, as the `kibi-clone` compose project: app on `127.0.0.1:8093`, DB on `127.0.0.1:18093`, behind nginx.
- **Deploys are unsafe.** There is no CI, no backup before migrations, no health check and no rollback.

## Solution

1. **Reconcile first.** Bring every production-relevant commit from `kibi-clone` into this repo, so this repo becomes the single source of production.
2. **CI on GitHub-hosted runners.** Every push and PR to `main` runs these jobs in parallel: test, build, migrations (against a Postgres service) and a TS/lint ratchet.
3. **Build in Actions.** On `main`, after CI passes, Actions builds the Docker image and pushes it to GHCR, tagged with the commit SHA and `latest`. The host never builds.
4. **Deploy by manual dispatch** (the owner stays on GitHub Free, so there is no environment approval). A `workflow_dispatch`-only deploy job, which refuses any commit whose CI run is not green, SSHes to the host as a dedicated `deploy` user whose key may run only one command: the deploy script with an image tag. The deploy script:
   1. `pg_dump`s the production database and keeps the last 7 dumps;
   2. pulls the image;
   3. runs `prisma migrate deploy` from the new image;
   4. switches the app container;
   5. health-checks `/api/health` on `127.0.0.1:8093`, and rolls back to the previous tag on failure;
   6. prunes to the last 3 image tags.
5. **Secrets.** Production `.env` stays on the host. GitHub holds only the host, the deploy key and the host fingerprint, as repository secrets. The host pulls from GHCR with a read-only token.
6. **Human steps.** Host preparation and the cutover from `kibi-clone` (keeping the same database volume) are human steps, guided by a wizard.
7. **Agent workflow.** Agents verify through CI instead of on the host.

## User Stories

1. As the shared host's operator, I want no builds and no routine test runs on my host, so that load and disk stop spiking.
2. As the owner, I want every change to `main` tested, built and migration-checked by CI, so that `main` is always releasable.
3. As the owner, I want to approve each production deploy, so that nothing ships without my say-so.
4. As the owner, I want a database backup before every migration, so that a bad migration is recoverable.
5. As the owner, I want a failed health check to roll back automatically, so that a broken release doesn't stay live.
6. As the owner, I want production secrets never stored in GitHub, so that a GitHub compromise doesn't expose them.
7. As the owner, I want a leaked deploy key to be able to do nothing except deploy an existing image, so that it cannot open a shell.
8. As the owner, I want production to run from this repo, with the kibi-clone-only fixes carried over, so that there is one source of truth.
9. As the owner, I want old images pruned after each deploy, so that disk use stays bounded.
10. As an agent, I want the rule to push and let CI verify, so that I stop loading the host.

## Implementation Decisions

- **Workflows:**
  - `.github/workflows/ci.yml` runs on push and PR to `main`, and on manual dispatch. Superseded runs are cancelled. It uses Node 20 with the npm cache, and has the jobs test, build, migrations (postgres:16 service; `migrate deploy`, then `migrate diff` must be empty) and ratchet (`ci/baselines.json`).
  - `.github/workflows/cd.yml` runs on `workflow_run` of CI completing successfully on `main`, and on manual dispatch with a tag. It has two jobs: `image` (buildx, push `ghcr.io/andrianm28/fundforindonesia.org:<sha>` and `:latest`, with GitHub Actions layer cache) and `deploy` (environment `production`; SSH with a pinned host key; runs the forced command with the SHA).
  - _Superseded 2026-09-26 (ticket 07, PR #27):_ the deploy is a separate `.github/workflows/deploy.yml` (`workflow_dispatch` only, no Environment on the Free plan, concurrency group `production`), so a new cd.yml build cannot push a waiting deploy out of the queue. Its gate checks green CI, the GHCR digests and the SLSA provenance before any SSH.
- **Production compose:** `docker-compose.prod.yml` uses `image: ghcr.io/…:${APP_TAG}` for the app and a one-off migrate service built from the same image. There is no `build:` in production. It uses the same service and volume names as the current production, so the existing database volume is reused. Volume naming is decided in the cutover ticket.
- **Deploy script:** `ops/deploy.sh <tag>`, run on the host by the `deploy` user through the forced command. Its steps are backup, pull, migrate, up, health check, rollback and prune, as above. It logs to a file. It is tested with the stub-docker technique from `src/__tests__/deploy-script.test.ts`. The existing `deploy.sh` remains for local or bootstrap use, or is folded in (decide in its ticket).
- **Health endpoint:** `GET /api/health` returns 200 with `{ ok: true }` when the database answers a trivial query, and 503 otherwise. It is never cached.
- **Host setup (human, wizard):**
  - create a `deploy` user in the `docker` group;
  - add the forced-command key to `authorized_keys`;
  - log in to GHCR with a read-only token;
  - create the deploy directory with the production `.env` and compose file;
  - store the host key fingerprint in a GitHub secret.

  **Cutover:** stop `kibi-clone`, deploy from this repo onto the same database volume, verify, then retire `/home/ubuntu/kibi-clone`.

## Testing Decisions

- **CI:** proven by green runs. A throwaway branch proves the migrations job fails on a schema/migration mismatch, and that the ratchet fails on one added TS error. Both branches are deleted afterwards.
- **Deploy script:** stub-docker tests cover the happy path, a migration failure (the app stays on the old tag), a health-check failure (rollback to the previous tag), and prune keeping 3 tags.
- **Health endpoint:** route tests for DB up (200) and DB down (503).
- **CD:** the first real deploy happens under the owner's approval, after the cutover checklist.

## Out of Scope

- Staging environments.
- Blue-green or zero-downtime deploys (a short restart gap is acceptable).
- Deploy notifications.
- Playwright e2e (a later ticket).
- Paying down the existing TS and lint errors.
- The other stacks on this host (galangdana and others).
