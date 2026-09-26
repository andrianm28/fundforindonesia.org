# 01: Bring kibi-clone's production fixes into this repo

**What to build:** Production runs from `/home/ubuntu/kibi-clone` (`github.com/andrianm28/kibi-clone`, `main` at `0045c62`), not from this repo.
- List every commit in `kibi-clone` that is not in fundforindonesia.org. Compare by content, since histories may differ.
- Classify each one: production-relevant (Dockerfile, compose, deploy, runtime fixes such as "stop bind-mounting public/images") or obsolete.
- Port the relevant ones here, on a branch, with tests where they apply.
- Record the list and the decisions in this ticket's Comments.

Read-only on `/home/ubuntu/kibi-clone`: don't change or deploy it.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] The list of kibi-clone-only commits and a decision for each are recorded
- [ ] Production-relevant changes are ported and tested here
- [ ] Differences between kibi-clone's compose/Dockerfile/.env.example and this repo's are listed, for the cutover ticket

## Comments

### 2026-09-26: reconciliation (branch `cicd-reconcile-kibi-clone`, draft PR #7)

**Method.** Compared by content. `diff -rq` of `/home/ubuntu/kibi-clone` (excluding `node_modules`, `.git`, `.env`, gitignored `src/generated/`) against `git archive 450ede5` of this repo shows exactly two differences. So kibi-clone `main` (`0045c62`) = fundforindonesia.org `450ede5` + one compose fix + one unrelated doc. Everything else in kibi-clone's tree is older than this repo (for example `src/lib/roles.ts` and `withRoleCheck.ts` were removed here later, in retire-role-hierarchy).

**kibi-clone commits and decisions**

| kibi-clone commit | Content | Decision |
|---|---|---|
| `e7cedd9` Initial commit: Kitabisa clone donation platform | Old pre-FFI snapshot. Also tracks `docs/SUPERAPP-PRAMUKA-JABAR-SPEC.md`, a spec for an unrelated project (SuperApp Pramuka Jawa Barat) | **Obsolete.** Code superseded by this repo's history. The Pramuka spec is not part of this product and is not ported. |
| `2f24b18` sync: working tree to fundforindonesia.org main (9681783) | `git archive` copy of this repo, plus deletion of wallet/top-up files already removed here | **Obsolete.** Content already here. |
| `8b0ee40` sync: self-hosted-font fix (2c31949) | Self-hosted Inter | **Obsolete.** Already here. |
| `4bf9b66` sync: working tree to main (450ede5), Ledger Line rollout | Copy of 450ede5 | **Obsolete.** Already here (tree byte-identical to 450ede5 apart from the next row). |
| `0045c62` fix: stop bind-mounting public/images | `docker-compose.yml`: removed `./public/images:/app/public/images:ro` from `app` | **Ported** as `35842e3` (+ `5eff357` from code review), with `src/__tests__/docker-compose.test.ts`: fails if any host path is mounted under `/app/public`, checks `uploads` stays on the named volume, and throws on long-form volume entries rather than letting them pass. |

The kibi-clone `deploy.sh` and `.gitignore` differ only because they're *older* (unconditional seed step; "specflow" comment). This repo's versions are newer and kept.

**Byte-identical between kibi-clone and this repo:** `Dockerfile`, `package.json`, `package-lock.json`, `next.config.mjs`, `prisma.config.ts`, `.env.example`.

### Differences the cutover (ticket 08) must know

1. **Production data volumes are `kibi-clone_postgres_data`** (db, mounted at `/var/lib/postgresql/data`, created 2026-09-16) and **`kibi-clone_uploads`** (app, `/app/public/uploads`). Compose derives these from the project name `kibi-clone` (the directory name) plus the logical names `postgres_data`/`uploads`. A compose file run from any other directory creates *new, empty* volumes. `docker-compose.prod.yml` must either set top-level `name: kibi-clone`, or declare both volumes `external: true` with `name: kibi-clone_postgres_data` / `name: kibi-clone_uploads`. External is safer: `down -v` can't delete them.
2. **Don't confuse with `fund-for-indonesia_postgres_data` / `fund-for-indonesia_uploads`.** These belong to a *different, still-running* compose project `fund-for-indonesia` in `/opt/fund-for-indonesia` (app `127.0.0.1:3000`, db `127.0.0.1:5432`, up 5 weeks). It is not production for `galang.fundforindonesia.org` (8093). There are also unrelated `fundforindonesia_pgdata`/`_miniodata`/`_meilidata` volumes. Decide separately whether that stack gets retired.
3. **Uploads live in a volume, not in the image.** Keep the `uploads:/app/public/uploads` mount (or the external `kibi-clone_uploads`) in the prod compose, or user uploads disappear on the first deploy.
4. **Service names and ports are unchanged:** `db` (postgres:16-alpine, `127.0.0.1:18093`), `app` (`127.0.0.1:8093`→3000), `migrate` and `seed` under profile `setup`. DB user `fundindo`, database `fund_indonesia`, password from `DB_PASSWORD`.
5. **Env variable names are identical.** The running app container has `DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MOCK_MIDTRANS_SERVER_KEY, PAYMENT_PROVIDER, NEXT_PUBLIC_DONATIONS_ENABLED, SUMOPOD_API_KEY, SUMOPOD_WEBHOOK_SECRET, SUMOPOD_BASE_URL`, matching this repo's compose and `.env.example`. Compose interpolation also needs `DB_PASSWORD`. Copy `/home/ubuntu/kibi-clone/.env` as-is; its values were not read. `MOCK_MIDTRANS_SERVER_KEY` has no default (`:?`), so the stack refuses to start without it.
6. **`NEXT_PUBLIC_DONATIONS_ENABLED` is baked in at build time.** Building in GHCR means the image carries whatever value CI builds with (the default is `false`). The CD image job must pass it as a build arg if production ever needs `true`. The Dockerfile has no `ARG` for it today, and it also hardcodes `NEXTAUTH_URL`/`NEXT_PUBLIC_BASE_URL=https://galang.fundforindonesia.org` at build time.
7. **The migrate service differs in kind.** Today it is `node:20-alpine` with bind mounts of `./prisma`, `package.json` etc., and runs `npm install prisma@7.8.0` at run time. The spec's prod migrate runs from the app image instead. Note that the runner stage copies `prisma/` and `node_modules/@prisma`, but not the `prisma` CLI package or `prisma.config.ts`, so `npx prisma migrate deploy` from the image likely needs Dockerfile work (inferred from the Dockerfile, not verified by running the image).
8. **Pending migrations at cutover.** Production's schema is at `450ede5`. This repo has 9 newer migrations (`20260925100000_add_campaign_status_change` through `20260926210000_add_submission_withdrawn_action`, including two "make … nullable" ones). The first deploy from this repo applies all of them: take the `pg_dump` first.
9. **Bind mount removed.** Production no longer mounts `./public/images` (already true in kibi-clone since 0045c62; now true here). The host needs no checkout of `public/` for the app to serve images.
10. **The current production image is `kibi-clone-app:latest`** (`30a1c6dedfb9`, built 2026-09-25 06:26, 2.35 GB), built on the host. Keep it until the first GHCR deploy is verified, as the rollback target, then remove it to reclaim disk.
