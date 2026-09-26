# 01: A deploy never runs the seed on a database that has data

**What to build:** `deploy.sh` runs `docker compose run --rm seed` on every deploy, under `set -e`. The seed deliberately refuses a database that already holds Campaigns or Donations, so every deploy after the first stops at the seed step and never reaches `docker compose up -d app`, and the app is left down. On a fresh database, the same step creates demo data including an operator account with a known password and both the ADMIN and VERIFIER assignments.

Make seeding an explicit, opt-in step. A normal deploy is build, then database, then migrations, then app, and never seeds. Seeding happens only when the operator asks for it (for example, `SEED=1 ./deploy.sh` or a separate command) and only on a fresh database. Don't weaken the seed's own refusal. This is top-10 gap #7 from `.scratch/prd-adr-gap-analysis/research.md`; see also `.scratch/deploy-readiness.md` §1.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] A default `./deploy.sh` run never invokes the seed; running it twice in a row gets to the app start both times
- [ ] Seeding runs only on an explicit opt-in, and the script says so in its output and usage comment
- [ ] The seed's refusal on a non-empty database is unchanged
- [ ] A test pins the default path, e.g. a shell or static test asserting that the seed step is gated. If the compose file defines a seed service, it stays but is never started by default. Full suite green
