# Handoff: FFI coordinator, VPS session → Claude Code cloud session

Written 2026-09-26 by the last coordinator session on the VPS. You are the first **cloud** coordinator for `andrianm28/fundforindonesia.org`. Start with `CLAUDE.md` (rules, workflow, model tiering), then `.scratch/cloud-migration/plan.md` (why, phases, handover checklist).

## Who and how

- The owner writes in Indonesian; reply in Indonesian. "ya" / "ya lanjut semua rekomendasi" means follow your recommendations.
- Still ask before any merge you haven't been cleared for, before changing GitHub settings, and before anything touching production.
- Workflow: vendored mattpocock skills only, called by bare name (`grilling`, `domain-modeling`, `to-spec`, `to-tickets`, `tdd`, `code-review`, `diagnosing-bugs`, `resolving-merge-conflicts`, `triage`, `wizard`, `handoff`).
- One ticket per subagent (`isolation: worktree`, `model: sonnet`, brief by path, report of at most 200 words). The coordinator merges PRs once CI is green and sets the ticket's `**Status:**` to `done (PR #n, sha)` **in the same PR or a small docs PR**. `.scratch/` is committed now.
- In the cloud, run the full suite, `tsc` and lint before pushing (`docs/agents/verification.md`). CI is the merge gate: test, build, migrations, ratchet (tsc ≤47, lint ≤194, never raise them), and image (cd.yml).
- Keep at most 3 builder subagents per cloud session. For more, the owner opens extra cloud sessions, one per ticket.

## First steps (handover checklist)

1. Check the session itself:
   - the SessionStart hook ran (`npm install` and `prisma generate`);
   - the skills list under bare names;
   - `npx vitest run` is green;
   - `gh pr list` works.
2. Open PRs from the VPS:
   - **#32, Kind Authorisation**: merged by the VPS coordinator (5854d61). Ticket 11 is done. Nothing to take over.
   - **#33, Platform Fee** (prd-compliance 17): **CI all green**, draft, not merged. The builder agent finished. Before you merge:
     - **How it works:** the rate resolves Campaign override → Category → Kind default, and falls back to 0 bps. Rounding is floor, in BigInt. Donations below the threshold pay no fee. The fee is frozen on `Payment.platformFee` at creation and posted unchanged to `PLATFORM_FEE` at settlement. Config lives in the append-only `PlatformFeeRule`/`PlatformFeeThreshold` tables via `POST /api/admin/platform-fee` (ADMIN).
     - **A review found a real bug, and it is fixed:** Refunds had hard-coded the Platform Fee portion to 0. It is now `platformFeePortionFor`.
     - **Owner decisions to get before merging:**
       1. The default rate per Kind. No rate is seeded, so the fee is 0% until an Admin sets one.
       2. Whether zakat and wakaf are fee-exempt. There is no hard-coded exemption; an Admin would set 0% for those Kinds.
       3. Whether an Admin UI is needed, or the API alone is enough for now.
     - The ticket's `**Status:**` line in `.scratch/` has not been set yet. Set it to done in a docs commit after the merge.
3. No VPS agent is working any more. The branch is yours.

## Next work (frontier)

Order comes from `.scratch/percepatan-produksi/plan.md` (fastest path to production):

- **Upgrade Next before 2026-10-10:** `ci-cd-github-actions/issues/15-next-major-upgrade.md`. The `.trivyignore` entry for GHSA-2xp9-vwfh-vxw4 expires that day, and the `image` job goes red.
- **prd-compliance, ready-for-agent:**
  - 18 (Sumopod donation end-to-end);
  - 21 (Receipt) and 22 (Akad Wakaf), which should name the Collecting Entity (ADR 0010);
  - 16 (encryption migrate and contract; see ticket 15's Comments for the steps);
  - 20 (scheduled jobs);
  - then the rest of `prd-compliance-fase-0-2/issues/` by blockers.
- **verification-request:** 09 (Active freezes title and description) and 10 (withdraw on the Campaign page).
- **Triage:**
  - `ci-cd-github-actions/issues/11-playwright-e2e.md` (needs-triage).
  - Several older files still read `ready-for-agent` but may be done, for example `volunteer-trip/issues/01-06` versus `volunteer-trip-operations`, and prd-compliance 01, 12 and 14. Check them against `main` before dispatching.
- **Dependabot PRs #10, #11, #13, #14, #15:** major bumps (tailwind 4, eslint-config-next 16, framer-motion 13, dotenv 18). Don't merge them blind. #15 belongs with the Next upgrade.

## Owner-only (VPS / GitHub; not doable from the cloud)

- **Cutover** (`ci-cd-github-actions/issues/08-host-setup-and-cutover.md`): everything is in its Comments. That covers:
  - the `deploy` user and forced command;
  - copying `ops/deploy.sh` and `docker-compose.prod.yml` to the host;
  - the repo secrets `DEPLOY_HOST`, `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS`;
  - the repo vars `NEXT_PUBLIC_BASE_URL=https://fundforindonesia.org` and `NEXTAUTH_URL`;
  - SMTP (Sumopod) and the four `FIELD_*` encryption keys in the production `.env`, with the keys backed up off-host;
  - checking Postgres local trust for `pg_dump`;
  - the first-deploy rollback;
  - removing the nginx `/_next/image` stopgap afterwards.
- **Pre-deploy list:** `.scratch/deploy-readiness.md`, which includes the migrations table, access and data checks, and behaviour changes. After the deploy, every existing Active Campaign refuses Donations until it has a Collecting Entity with a permit. Register YIEM first (`percepatan-produksi/issues/02`).
- **Other ready-for-human tickets:**
  - `percepatan-produksi/issues/01` (Sumopod credentials);
  - `campaign-status-transitions/issues/11`;
  - `legacy-status-contract/issues/03`;
  - `retire-role-hierarchy/issues/03`;
  - `operator-rule-gaps/issues/03`.
- **Production today** is still the kibi-clone stack on the VPS: `/home/ubuntu/kibi-clone`, :8093, behind nginx. Never touch it.
  - An nginx stopgap blocks `/_next/image` on fundforindonesia.org and galang. It closes the Next RCE; the cost is that optimizer images don't render until the cutover.
  - The config backups are in `/etc/nginx/backup-ffi-20260926/`.
- **Shared host:** the makam project uses the same Docker daemon. No host-wide prunes (plan phase 4).

## Reference

- **Domain:** `CONTEXT.md` and `docs/adr/`. Recent decisions:
  - Kind is fixed once a Campaign leaves Draft;
  - Partner Organisation and Collecting Entity rules;
  - `.org` is the canonical domain (`publicUrl()`).
- **Recently merged on 2026-09-26** (details in the PRs):
  - #19 Mailer;
  - #20 Kind;
  - #21 image optimizer off;
  - #24 `ops/deploy.sh`;
  - #25 field encryption expand;
  - #26 Partner Organisation, Collecting Entity and the permit gate;
  - #27 `deploy.yml`;
  - #28 canonical domain;
  - #29 slim image;
  - #30 cloud readiness;
  - #31 plan note.
- **Roadmap for the owner:** Claude Docs "Roadmap FFI — status 26 September 2026", https://claude.ai/code/artifact/1d0de03d-eb75-4bf3-8978-89bcac4d1591. It was last updated before PRs #19–#31 merged, so refresh it when you next report status.

## Suggested skills

- `triage`: sort out stale `ready-for-agent` files and the Playwright ticket.
- `tdd` and `code-review`: every ticket, through subagents.
- `resolving-merge-conflicts`: when #32 and #33 or later branches conflict.
- `diagnosing-bugs`: CI failures that aren't obvious, starting with #33's ratchet if the cause is unclear.
- `grilling` and `domain-modeling`: new policy questions (Platform Fee rates, Hibah rules), keeping `CONTEXT.md` current.
- `wizard`: if the owner wants a guided script for the cutover (ci-cd 08).
