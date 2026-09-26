# 05: Build the production image in Actions and push it to GHCR

**What to build:**
- A `cd.yml` `image` job. It is triggered after CI succeeds on `main` (`workflow_run`), and by manual dispatch. It builds the Dockerfile with buildx and the GitHub Actions layer cache, and pushes `ghcr.io/andrianm28/fundforindonesia.org:<sha>` and `:latest` using `GITHUB_TOKEN` with `packages: write`.
- `docker-compose.prod.yml`: the app and a one-off migrate service use that image via `${APP_TAG}`, with no `build:`. Service and volume names are chosen with ticket 01's findings, so the existing database volume can be reused.

**Blocked by:** 02, 01

**Status:** done

- [ ] A green `main` run produces both tags in GHCR, and the package is private
- [ ] `docker-compose.prod.yml` validates (`docker compose config`) with a sample `.env`
- [ ] The image never contains secrets (build args and a layer check)

## Comments

- 2026-09-26 (from ticket 01): the Dockerfile bakes `NEXT_PUBLIC_DONATIONS_ENABLED` and the production URLs in at build time, with no build args. The GHCR image must take them as build args from GitHub Environment `production` variables (not secrets: they are public by nature), or the image must read them at runtime. Decide in this ticket.
- 2026-09-26 (from ticket 01): the migrate step should run from the app image, but that image appears to lack the `prisma` CLI and `prisma.config.ts`. Either add a dedicated `migrate` target to the Dockerfile that has them, or keep a separate small migrate image built in the same job.

## Comments

- 2026-09-26 (best-practice audit):
  - Build once and deploy by **digest**: tag `:<sha>`, and record the pushed digest as a job output for ticket 07.
  - Add `actions/attest-build-provenance` (the job needs `id-token: write` and `attestations: write`).
  - Scan the image with Trivy, failing on CRITICAL findings that have a fix.
  - Grant `packages: write` only on this job.
  - Pin all actions to SHAs (current: docker/setup-buildx-action v4.4.1, docker/login-action v4.6.0, docker/build-push-action v7.4.0, docker/metadata-action v6.2.0, actions/attest-build-provenance v4.2.2, aquasecurity/trivy-action v0.36.0).
  - `NEXT_PUBLIC_*` and the production URLs come from build args set by GitHub Environment `production` variables.
- 2026-09-26 (done, PR #16): build args come from repository-level Actions variables (`vars.NEXT_PUBLIC_BASE_URL`, `vars.NEXTAUTH_URL`, `vars.NEXT_PUBLIC_DONATIONS_ENABLED`; defaults `https://galang.fundforindonesia.org` and `false`), not Environment variables, because the owner stays on the Free plan. GitHub artifact attestation is unavailable on a private user repo, so buildx `provenance: mode=max` in GHCR is the attestation.
