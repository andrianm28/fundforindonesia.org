# Spec: production environment and protected main

Source: owner, via the VPS session's update of 2026-09-26. The repository is
public, so GitHub Free now allows environment required reviewers and branch
protection (ticket 10 was wontfix only because Free refused both).

## Goal

A deploy runs only for a green commit on `main`, and only after the owner
approves it in GitHub. The deploy secrets are readable only by that approved
job. `main` cannot be merged without CI, force-pushed or deleted.

## Decisions

- Environment `production`: required reviewer = owner (andrianm28), deployment
  branches = `main` only. `DEPLOY_HOST`, `DEPLOY_SSH_KEY` and
  `DEPLOY_KNOWN_HOSTS` are **environment** secrets, not repo secrets (none is
  set yet).
- `deploy.yml` keeps `workflow_dispatch`, the main-only rule, `ci/deploy-gate.sh`
  and concurrency group `production`, and splits into two jobs: `gate` (no
  environment) and `deploy` (`environment: production`, `needs: gate`). The
  owner is asked to approve only a commit that already passed the gate.
- Agents, including the cloud coordinator, may dispatch `deploy.yml` for a
  `main` commit with green CI. Approval stays with the owner through the
  environment reviewer; an agent never approves a deployment.
- GitHub settings (environment, secrets, branch protection) are the owner's,
  in the GitHub UI, or an agent's through the API only after the owner
  explicitly allows that call.
- Runner pin to ubuntu-24.04: already done (ticket 16, PR #38).

## Tickets

- 10: branch protection on `main` (ready-for-human, reopened)
- 23: create the `production` environment and its secrets (ready-for-human)
- 24: `deploy.yml` gate job + environment job, and the dispatch policy in the docs (ready-for-agent)

The first real deploy still waits for the cutover, ticket 08.
