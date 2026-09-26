# 07: The deploy job: approved, forced-command SSH to the host

**What to build:** A `cd.yml` `deploy` job after `image`. It runs in environment `production`, which requires the owner's approval. It SSHes to the host with the deploy key and a pinned host key (secrets `DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`), passing only the image SHA, which the forced command hands to `ops/deploy.sh`. The job fails if the script fails. Manual dispatch with a tag supports redeploying a previous version.

**Blocked by:** 05, 06

**Status:** done (PR #27, a604d69)

- [ ] The job needs approval in `production` and uses only the three secrets
- [ ] Nothing but the tag is sent over SSH; the host key is pinned
- [ ] Documented how to redeploy or roll back to a given SHA

## Comments

- 2026-09-26 (best-practice audit):
  - `concurrency: { group: production, cancel-in-progress: false }`, so deploys never overlap.
  - The secrets live in Environment `production` only, not in repository secrets.
  - The job has only `contents: read`.
  - Pass the digest from ticket 05 to the forced command.
  - Pin all actions to SHAs.
- 2026-09-26, **owner decision: stay on GitHub Free**, which overrides the environment approval above. The deploy job:
  - is triggered **only by `workflow_dispatch`**, with an input for the commit SHA (default: current `main`). Only people with write access can dispatch it, so dispatching is the approval;
  - **refuses unless the CI workflow succeeded on that exact SHA** (`gh api .../actions/runs?head_sha=<sha>&status=success` for workflow CI), and unless a GHCR image and digest exist for it;
  - uses repository-level secrets `DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, and no environment;
  - keeps `concurrency: { group: production, cancel-in-progress: false }`;
  - has permissions `contents: read` and `actions: read`.
- 2026-09-26 (from ticket 05): the deploy job takes `app-digest` and `migrate-digest` from the image job (`needs.image.outputs`) or, for a manual deploy, from that run's summary.

- 2026-09-26, from ticket 06 (PR #24):
  - The job sends exactly `"$SHA $APP_DIGEST $MIGRATE_DIGEST"` over SSH: the full 40-hex SHA, without the script name. The forced command runs `ops/deploy.sh`, which reads `SSH_ORIGINAL_COMMAND`.
  - Any non-zero exit fails the job. Show what the code means: 1 a step failed, 2 bad input, 3 rolled back and healthy, 4 production needs a human.
  - Nothing ships `ops/deploy.sh` or `docker-compose.prod.yml` to the host. Decide whether 07 automates that or 08 documents a manual copy.
