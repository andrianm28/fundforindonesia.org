# 06: The host deploy script: backup, migrate, switch, check, roll back, prune

**What to build:** `ops/deploy.sh <tag>`, run on the host by the `deploy` user. Steps:
1. Validate the tag format.
2. `pg_dump` into the backup directory, keeping the last 7.
3. Pull the image.
4. Run `prisma migrate deploy` from the new image. If it fails, stop: the old app keeps running.
5. Recreate the app on the new tag.
6. Poll `http://127.0.0.1:8093/api/health` for up to 60 s. If it fails, recreate on the previous tag and exit non-zero.
7. Record the current and previous tags.
8. Prune images, keeping the last 3 tags.

Everything is logged to a file. Tests use the stub-docker approach of `src/__tests__/deploy-script.test.ts` and never touch real Docker.

**Blocked by:** 04, 05

**Status:** done (PR #24, 6f08354)

- [ ] Happy path; migration failure (no app switch); health failure (rollback); prune keeps 3; invalid tag rejected: all tested with stubs
- [ ] The script reads the production `.env` from the deploy directory and never prints secrets

## Comments

- 2026-09-26 (best-practice audit): the script receives an image **digest** (`sha256:…`) as well as the SHA tag, and runs `image@digest`. It rejects anything that is not a 64-hex digest, and keeps the previous digest for rollback.
- 2026-09-26 (from ticket 05): the inputs are `APP_DIGEST` and `MIGRATE_DIGEST`; compose interpolates the whole file, so both must be set. Migrate runs with `docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate`. Prune both `:<sha>` and `:<sha>-migrate`. The compose project is `fundforindonesia-prod`.
