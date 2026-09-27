# 08: Prepare the host and cut production over from kibi-clone

**What to build:** A human-run wizard (``wizard` skill`) for the steps only the owner may take on the production host and in GitHub settings:
- create the `deploy` user (docker group, no sudo);
- add the forced-command key (`command="…/ops/deploy.sh-wrapper",no-pty,no-port-forwarding,…`);
- log the host in to GHCR with a read-only token;
- create the deploy directory with the production `.env` (moved from `/home/ubuntu/kibi-clone/.env`) and `docker-compose.prod.yml`;
- create the GitHub Environment `production` with the owner as required reviewer, and the three secrets.

**Cutover:**
1. Back up the database.
2. Stop `kibi-clone`.
3. Deploy from this repo onto the same database volume.
4. Verify the site behind nginx.
5. Keep kibi-clone's checkout for a week, then retire it.

**Blocked by:** 01, 07

**Status:** ready-for-human

- [ ] Every step is done and checked off in the wizard, with a rollback path at each step
- [ ] Production is served by an image from this repo, and `kibi-clone` is stopped

## Comments

- 2026-09-26 (from ticket 01): the production data lives in Docker volumes `kibi-clone_postgres_data` and `kibi-clone_uploads`. Declare them `external: true` with those exact names in `docker-compose.prod.yml`, so `down -v` can never delete them and a different project directory cannot create empty ones. Do NOT confuse them with `fund-for-indonesia_*`, which belong to the separate `/opt/fund-for-indonesia` stack (127.0.0.1:3000 and :5432).
- 2026-09-26 (from ticket 01): the first deploy applies 9 new migrations (20260925100000 … 20260926210000). The backup step is mandatory.
- 2026-09-26 (from ticket 01): the current production image `kibi-clone-app:latest` (30a1c6dedfb9) stays as the rollback target until the first GHCR deploy is verified. Do not prune it.
- 2026-09-26: Stay on Free, so the GitHub environment step is dropped. Create the repository-level secrets (`DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`) and the build variables that ticket 05 lists.
- 2026-09-26 (from ticket 05): the new compose project `fundforindonesia-prod` uses different container names, so **stop the kibi-clone stack before `up`** or the ports clash. The production compose requires `DB_PASSWORD`. If kibi-clone's `.env` lacks it, production is running on the old default `changeme123`: set a strong one explicitly (and change the database user's password to match) during cutover. After the first push to main, check that the GHCR package is private and linked to the repo.
- 2026-09-26: checked (key name only, value not read): `/home/ubuntu/kibi-clone/.env` has a non-empty `DB_PASSWORD`, so production is not on the `changeme123` default. Copy it as-is during cutover.

- 2026-09-26: **SMTP is part of the cutover** (decision on prd-compliance 13, PR #19). The production `.env` must set `MAIL_PROVIDER=smtp`, `SMTP_HOST=smtp.sumopod.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` (Sumopod credentials: percepatan-produksi 01). If they are missing, Verifier decisions still go through, but the email is not sent and a `mail_not_configured` line appears in the logs. After cutover, check the logs for that line.

- 2026-09-26, from ticket 06 (PR #24):
  - The forced command is `command="<dir>/ops/deploy.sh",no-pty,...`. There is no wrapper, which replaces `deploy.sh-wrapper` above. `DEPLOY_DIR` holds `.env`, `docker-compose.prod.yml` and `ops/`.
  - Before cutover, check that kibi-clone's Postgres uses the image's default local trust (no `POSTGRES_HOST_AUTH_METHOD`), user `fundindo` and db `fund_indonesia`. The `pg_dump` backup depends on it.
  - First deploy: there is no rollback target. Exit 4 means the migrations already ran and the broken app is on :8093. The rollback step is to stop it, start kibi-clone, and restore the `backups/*.dump` if needed.

- 2026-09-26, from ticket 07 (PR #27) and public-domain 01 (PR #28):
  - **Manual file copy:** 07 does not ship `ops/deploy.sh` or `docker-compose.prod.yml`. Letting the forced-command key write files would make a leaked key effectively root. At setup, copy both into `DEPLOY_DIR`. Standing rule: when a release changes either file, copy the new one from that commit to the host **before** dispatching.
  - **authorized_keys:** use `command="<DEPLOY_DIR>/ops/deploy.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding` for user `deploy`, on port 22.
  - **Repo secrets:** `DEPLOY_HOST` (bare host or IP), `DEPLOY_SSH_KEY`, and `DEPLOY_KNOWN_HOSTS` (from `ssh-keyscan`, verified out of band).
  - **GHCR:** the package stays linked to the repo with Actions read access, and the host logs in to GHCR with a read-only token.
  - **Timeout or dropped SSH (exit 255):** the script keeps running on the host. Check `logs/deploy.log` before retrying.
  - **Domain:** set the repo var `NEXT_PUBLIC_BASE_URL=https://fundforindonesia.org`. Set `NEXTAUTH_URL` to the apex, or redirect galang to it.
  - **nginx:** remove the `/_next/image` stopgap block after the cutover. Backups are in `/etc/nginx/backup-ffi-20260926/`.

- 2026-09-27, from prd-compliance 45 (ready-for-human, owner's step at the cutover):
  - **The scheduled jobs need one more host step, or they never run.** The route
    `POST /api/internal/jobs/run` is in the repo and is the only caller of
    `runScheduledJobs`, but a route is not a schedule. Add `JOBS_SECRET` to the
    production `.env` (generate with `openssl rand -base64 32`, never in git)
    and install one cron entry. Until both are done, matured escrow is
    released only when a Fundraiser happens to request a Payout, and the
    Campaign deadline reminders and Kind Authorisation expiry warnings send
    nothing at all -- that is the state production is in today.
  - The cron entry, reading the secret from the `.env` rather than putting it
    on the crontab line:

    ```cron
    */15 * * * * . "$DEPLOY_DIR/.env" && curl -fsS -X POST -H "x-jobs-secret: $JOBS_SECRET" http://127.0.0.1:8093/api/internal/jobs/run >> "$DEPLOY_DIR/logs/jobs.log" 2>&1
    ```

    127.0.0.1:8093 is the app container's port, the one `/api/health` (ci-cd 04)
    is already polled on, so the call stays off the public internet.
  - **Check it by hand after the first deploy** of the release that adds the
    route: a 401 means the secret does not match, a 200 with per-phase counts
    means it ran. Call it twice on purpose -- the second call reports zeros and
    moves nothing, which is the idempotency the job relies on.
  - A scheduled GitHub Actions workflow was the alternative and was not chosen;
    the reasoning, and what would change it, is in prd-compliance 45's Comments.
    If the owner prefers it, the secret moves to an Actions secret and the
    workflow calls the same public URL.
