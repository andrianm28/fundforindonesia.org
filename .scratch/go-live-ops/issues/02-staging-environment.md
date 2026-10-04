# 02: Staging environment with an explicit, staging-only sandbox permission

**What to build:** A staging stack on the same host family as production, so M1, M2 and M3 are exercised end to end against the Sumopod sandbox before any real rupiah moves. Plan item G-1 (`.scratch/percepatan-full-rilis/plan.md`, table "Menuju M1").

1. `docker-compose.staging.yml`: its own Compose project name, its own database and its own volumes (never the `kibi-clone_*` ones), loopback ports distinct from production, no host builds, every secret read from a `STAGING_`-prefixed variable so a production `.env` can never leak into it by name.
2. A staging image variant in `.github/workflows/cd.yml`: same Dockerfile and `runner` target, tag `<sha>-staging`, built with staging build args (`NEXT_PUBLIC_*` are inlined at build time). The production image, its tags, its build args and `deploy.yml` / `ci/deploy-gate.sh` are untouched.
3. The sandbox interlock (`sandboxInProductionReason`) allows a Sumopod sandbox base URL **only** when `DEPLOY_ENVIRONMENT=staging` (exact string), never by default, and in that mode refuses a base URL that is not a sandbox, so staging cannot take real money either. `docker-compose.prod.yml` can never pass `DEPLOY_ENVIRONMENT`.
4. Noindex and basic auth for staging, at nginx (documented, not app code).
5. Seed guard: `prisma/seed.ts` refuses to run against a production deployment that is not staging; the runbook states seed is staging-only and nothing is ever copied from production.
6. `docs/runbooks/staging.md`, without IPs or credentials.

No migration. `.env.example` and `package.json` are the coordinator's to change; new variables are reported in the Comments.

**Blocked by:** none

**Status:** ready-for-agent (owner approved 2026-10-04)

- [ ] `docker-compose.staging.yml` has a distinct project name, no external volumes, no `kibi-clone` reference, distinct loopback ports, digest-pinned images, and passes `DEPLOY_ENVIRONMENT: staging`
- [ ] `docker-compose.prod.yml` never passes `DEPLOY_ENVIRONMENT`
- [ ] `cd.yml` builds and pushes the `-staging` image with staging build args; the production build args and tags are unchanged
- [ ] Sandbox base URL is allowed only with `DEPLOY_ENVIRONMENT=staging`; refused in production otherwise; a live base URL is refused in staging; mock, unset URL and unknown provider stay refused
- [ ] Seed refuses a production deployment that is not staging
- [ ] `docs/runbooks/staging.md` covers nginx noindex + basic auth (webhook path exempt), seed, first bring-up and the env list

## Comments

- 2026-10-04: owner approved this ticket (plan G-1).
