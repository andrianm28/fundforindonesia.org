# Spec: CI on GitHub-hosted runners

Status: ready-for-agent
Source: the user's request of 2026-09-26 ("pindahkan CI build/test ke GitHub Actions hosted runner"), plus a report from the `yiem-main-agent` session: this project's vitest runs, builds and Docker migration checks on the shared host pushed the load average to about 22 on 8 cores, and left roughly 11 GB of Docker build cache that needed three manual cleanups in a week. Decided in the grilling of 2026-09-26 (Q1–Q6).

## Problem Statement

All verification for this repo runs on a shared host: the full vitest suite (about 2,400 tests), `tsc`, `next build`, and throwaway Postgres containers for migration checks. Every agent does this, and so does every merge, often with four agents in parallel. The host is shared with other projects, which feel the load and the disk use. The repo has no CI at all, so nothing verifies `main` independently of this host.

## Solution

A GitHub Actions workflow on **GitHub-hosted** runners (`ubuntu-latest`, never self-hosted) verifies every push to `main` and every pull request to `main`. It runs these jobs in parallel:
- **test:** vitest;
- **build:** `next build`;
- **migrations:** `prisma migrate deploy` into a Postgres 16 service container, then `migrate diff` must be empty;
- **typecheck and lint:** each must not exceed a committed baseline error count (a ratchet).

Pushing a newer commit to the same branch cancels the older run. Agents then stop running the full suite and Docker checks on the host: they run only the tests relevant to their change, push their branch, and the branch merges to `main` after CI is green. Branch protection is turned on by a human once the workflow is proven.

## User Stories

1. As the operator of the shared host, I want this repo's routine test and build work off my host, so that load and Docker disk use stop spiking.
2. As a maintainer, I want every push to `main` and every PR verified by CI, so that `main`'s health does not depend on one machine.
3. As a maintainer, I want migrations checked against a real Postgres on every change, so that an offline-generated migration never reaches production unapplied.
4. As a maintainer, I want CI to fail when TypeScript or lint errors increase, so that the existing debt (50 and 169 errors) can only shrink.
5. As a maintainer, I want superseded runs cancelled, so that Actions minutes aren't wasted.
6. As an agent working in this repo, I want clear instructions to run only targeted tests locally and let CI do the rest, so that I stop loading the shared host.
7. As the repo owner, I want to enable branch protection myself, once CI is proven, so that repository settings stay under my control.

## Implementation Decisions

- **Workflow:** `.github/workflows/ci.yml`.
  - Triggers: `push` to `main`, `pull_request` to `main`, and `workflow_dispatch`.
  - `concurrency: ci-${{ github.ref }}`, with `cancel-in-progress: true`.
  - Every job uses Node 20 via `actions/setup-node` with `cache: npm`, then `npm ci` and `npx prisma generate`.
- **test job:** `npx vitest run`. The `deploy.sh` test needs `bash`, which the runner has.
- **build job:** `npx next build`, with `DATABASE_URL` set to a dummy value so the build-time Prisma mock is used, and `NEXTAUTH_SECRET` set to a placeholder if the build needs it.
- **migrations job:**
  - a `postgres:16` service with a health check;
  - `DATABASE_URL` pointing at it;
  - `npx prisma migrate deploy`;
  - `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, and the job fails unless the output is the empty-migration marker.
- **Ratchet job (ticket 02):**
  - `ci/baselines.json` holds `{ "tsc": N, "lint": M }`.
  - A small Node script counts `error TS` lines from `npx tsc --noEmit`, and the errors from `npx next lint`, which should output JSON if it can.
  - The job fails if either count exceeds its baseline, and prints a reminder to lower the baseline when the count drops.
- **No Docker image build, no Playwright e2e, no deploy** in this spec.
- **Agent workflow (ticket 03):** `docs/agents/` and `CLAUDE.md` gain a short section:
  - run only the tests relevant to the change locally;
  - never run throwaway Docker Postgres checks on the host;
  - push the feature branch;
  - read the CI result with `gh run` / `gh pr checks`;
  - merge to `main` only after green.
- **Branch protection (ticket 04):** a human-only step.

## Testing Decisions

- The workflow is proven by running: the first green run on the feature branch, then on `main`.
- The migrations job must be shown to fail on a broken migration: a throwaway commit with a schema/migration mismatch, pushed on a scratch branch, then deleted.
- The ratchet must be shown to fail when a count exceeds its baseline: a throwaway commit adding one TS error, on a scratch branch, then deleted.

## Out of Scope

- Playwright e2e in CI (ticket 05, later).
- Building the Docker image in CI.
- Deploying from CI.
- Self-hosted runners, which would load the same host.
- Paying down the 50 TS and 169 lint errors (separate work; the ratchet only prevents growth).

Superseded by `.scratch/ci-cd-github-actions/` (2026-09-26).
