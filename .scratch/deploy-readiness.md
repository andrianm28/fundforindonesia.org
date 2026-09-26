# Deploy readiness: changes since `87cce13` (C20 onward)

Compiled 2026-09-26 from the work merged on 25–26 September. This covers everything someone deploying this code to production must check, run, or know. The work comes from these areas:
- `.scratch/campaign-status-transitions/`
- `campaign-rule-bugs/`
- `lifecycle-runner-and-adapter/`
- `subject-guard-and-suspension-money/`
- `effective-status-listings/`
- `operator-rule-gaps/`
- `capacity-judgement/`
- `flaky-tests/`
- `legacy-status-contract/`, in progress

## 0. What changed on 26 September (CI/CD)

- **CI is live on GitHub-hosted runners.** `.github/workflows/ci.yml` runs test (full vitest), build (`next build`), migrations (Postgres 16 service: `migrate deploy`, then an empty `migrate diff`) and ratchet (TS/lint counts versus `ci/baselines.json`) on every push and PR to `main`. `main` has been green since PR #9. Routine verification no longer runs on this host.
- **Runtime is now Node 24 LTS.** `.nvmrc` is 24, and the Dockerfile and compose helper images use `node:24-alpine` (Node 20 has been EOL since April 2026). The first production deploy from this repo therefore also changes the Node major version, which CI has verified.
- **`GET /api/health`** returns 200 `{ok:true}` when the database answers, and 503 otherwise. The deploy script polls it (ticket 06).
- **Compose no longer bind-mounts `./public/images`** (ported from kibi-clone `0045c62`). The mount crash-looped the container.
- **CD is in progress** (`.scratch/ci-cd-github-actions/` tickets 05–08). The image will be built in Actions and pushed to GHCR, and the host will only pull by digest. Until the cutover (ticket 08), production keeps running from `/home/ubuntu/kibi-clone`, and `kibi-clone-app:latest` is the rollback image.
- **Production data volumes are `kibi-clone_postgres_data` and `kibi-clone_uploads`.** The production compose must declare them `external: true`. Do not confuse them with `fund-for-indonesia_*`, which belong to the separate `/opt/fund-for-indonesia` stack.
- **Owner tasks in GitHub, doable now:**
  - branch protection on `main`, requiring test, build, migrations and ratchet (ticket 10);
  - the `production` environment with yourself as required reviewer (ticket 08). Its variables and secrets come once tickets 05 and 07 list them.

## 1. Deploy script and the seeded demo account (top-10 gap #7)

`deploy.sh` runs `docker compose run --rm seed` on **every** deploy, under `set -e`. The seed refuses a database that already has data, so the second deploy stops before step 5 and the app never starts. On a fresh environment, the seed creates `admin@kitabisa.com` / `password123` with both the ADMIN and VERIFIER assignments.

- [x] **Fixed (deploy-fixes 01):** a default `./deploy.sh` never seeds, so repeated deploys reach the app start. Seeding needs an explicit `SEED=1 ./deploy.sh`, on a fresh database only.
- [ ] If the seed ever ran on production: delete or re-password `admin@kitabisa.com`, and remove its assignments.

## 2. Migrations (run in this order)

`prisma migrate deploy` applies them in timestamp order. All three are additive and were verified on 2026-09-25 against a fresh Postgres 16: they apply cleanly and `migrate diff` against the schema is empty.

| Migration | Adds |
| --- | --- |
| `20260925100000_add_campaign_status_change` | Append-only status-change log (ON DELETE RESTRICT to Campaign and User) |
| `20260925110000_add_cancellation_request` | `CancellationRequest` table and status enum |
| `20260925120000_add_campaign_flag` | `CampaignFlag` table and resolution enum |
| `20260926100000_make_campaign_status_nullable` | `Campaign.status` becomes nullable with no default (legacy-status-contract 02; verified on Postgres 16) |
| `20260926130000_add_volunteer_trip_status_change` | Volunteer Trip status-change log (volunteer-trip-operations 01; verified on Postgres 16) |
| `20260926150000_make_user_role_and_verification_nullable` | `User.role` / `isVerified` lose NOT NULL and defaults (retire-role-hierarchy 02; verified on Postgres 16) |
| `20260926170000_add_verification_request` | Verification Request, Identity Verification and checklist tables; seeds 3 checklist items; **backfills a PENDING request for every Campaign already SUBMITTED**; Campaign default becomes DRAFT (verified on Postgres 16) |
| `20260926190000_add_verification_checklist_audit` | Audit table for checklist edits (verification-request 04; verified on Postgres 16) |
| `20260926210000_add_submission_withdrawn_action` | New status-change action SUBMISSION_WITHDRAWN (verification-request 03; verified on Postgres 16) |
| `20260926230000_add_campaign_kind` | `Kind` enum and `Campaign.kind` NOT NULL DEFAULT DONATION (existing Campaigns become Donation); prd-compliance 09, verified in CI |
| `20260927010000_add_contact_field_encryption` | 8 nullable ciphertext/HMAC columns on User and BankAccount + index; prd-compliance 15, verified in CI |
| `20260927010000_add_partner_organisation_collecting_entity` | PartnerOrganisation, FundraisingPermit, audit table; nullable `collectingEntityId` on Campaign and VerificationRequest; status action COLLECTING_ENTITY_ASSIGNED; prd-compliance 10, verified in CI |
| `20260927020000_add_kind_authorisation` | KindAuthorisation table, 2 audit enum values, nullable `kindAuthorisationId` on the audit table; prd-compliance 11, verified in CI |

- [ ] Take a database backup.
- [ ] Run `prisma migrate deploy` on **staging** first, then production.
- [ ] After production: `prisma migrate status` reports "up to date".

**Coming later, not yet in `main`:** `legacy-status-contract` ticket 03 **drops** `Campaign.status`. Ticket 03 must be deployed only after ticket 02 has been live in production (see §6).

## 3. Access checks (run before deploying)

Admin and Verifier power now comes only from **assignments** (ADR 0005):
- `/admin`, the admin pages and the owner routes read the ADMIN assignment;
- `/moderasi` reads the VERIFIER assignment;
- the legacy ADMIN and MODERATOR Roles grant nothing any more.

The 2026-09-20 backfill gave assignments to everyone who held those Roles then. Anyone promoted **after** that date through the Role editor may be missing them.

- [ ] Nobody with the ADMIN Role lacks the ADMIN assignment:
  ```sql
  SELECT u.email FROM "User" u
  WHERE u.role = 'ADMIN'
    AND NOT EXISTS (SELECT 1 FROM "UserAssignment" a WHERE a."userId" = u.id AND a.assignment = 'ADMIN');
  ```
- [ ] Nobody who should verify lacks the VERIFIER assignment:
  ```sql
  SELECT u.email, u.role FROM "User" u
  WHERE u.role IN ('MODERATOR','ADMIN')
    AND NOT EXISTS (SELECT 1 FROM "UserAssignment" a WHERE a."userId" = u.id AND a.assignment = 'VERIFIER');
  ```
- [ ] Grant any missing assignment through `/admin/users` (this is audited in `AssignmentAuditEntry`) before deploying. Otherwise that person loses access.
- [ ] At least **two** people hold ADMIN. Lifting a Suspension, and the Payout and Refund two-person rules, all need a second Admin, and there is deliberately no single-Admin override.

## 4. Data checks

- [ ] **Legacy Suspensions (ticket 11, `campaign-status-transitions`):** before the migrations run, count `SELECT count(*) FROM "Campaign" WHERE "lifecycleStatus" = 'SUSPENDED';`. Every Suspension made before the log existed cannot be lifted (409 "hubungi tim teknis") until it is backfilled. If the count is 0, close ticket 11 as `wontfix`.
- [ ] **Stored-Active Campaigns past their deadline:** these are expected. There is no expiry job yet (prd-compliance ticket 20). They are hidden from every public list, refuse Donations and Payouts, show "telah berakhir", and are recorded EXPIRED the next time anyone acts on them. Nothing needs doing now.

## 5. Behaviour changes someone may notice

**Frontend and clients:** check any client that matches on the old text or fields.
- Money routes (Payout and Refund, Campaign and Trip) now answer `{ error, code }` with Indonesian messages. The old English texts are gone, so match on `code`.
- `GET /api/campaigns` ignores `?status=`: it was a leak of Submitted, Rejected and Suspended Campaigns.
- `GET /api/campaigns/[slug]` now carries `lifecycleStatus`, the effective status. The Suspension reason is included only for the owning Fundraiser. `legacy-status-contract` ticket 01 (in progress) removes `status` from the payloads.
- `DELETE /api/campaigns/[slug]` no longer exists and answers 405 (ADR 0016). The Admin delete button is gone.
- The Volunteer Trip moderation route answers `{ trip }` with the new status, and 409 `TRIP_NOT_SUBMITTED` for a Trip that is not Submitted.
- Owner-only routes answer 403 `NOT_AUTHORIZED` with "Hanya Fundraiser … ini …", replacing a mix of "Forbidden" and assorted texts.
- Any registered user can now create a Campaign (SUBMITTED) or a Volunteer Trip (DRAFT, then submitted), with no Role needed. Publication is gated by Verifier approval, and until Verification Request exists, Verifiers check identity outside the system before approving a person's first submission.
- Submitting a Volunteer Trip is a Fundraiser action: an Admin who is not the owner gets 403. A Trip submit from the wrong status answers 409 `TRIP_NOT_EDITABLE`, not 400.

**Users:**
- A Suspended Campaign freezes its money. Payouts are refused, and matured Escrow Hold stays in hold. Refunds still work.
- A Cancelled Campaign refuses Payouts.
- Public lists (home, Urgent rail, explore, search, zakat) show only effectively Active Campaigns. Ended ones stay reachable by link and remain in the sitemap.
- For up to about 6 minutes after a Suspension, a cached Campaign page may still show the donate button, because of ISR and the API's `s-maxage`/`stale-while-revalidate`. The server refuses the Donation, so no money moves.

**Operations:**
- The Admin reconcile report labels Escrow held by a Suspension with `cause: "SUSPENDED"`, so it doesn't look like a stuck sweep.

## 6. Scheduled follow-ups tied to deploys

- [ ] `legacy-status-contract` ticket 03 (drop `Campaign.status`): only after ticket 02 is **live in production**. It is ready-for-human for that reason.
- [ ] prd-compliance ticket 40: pick one bcrypt cost factor. It now lives in `src/lib/password-hash-cost.ts`: registration 12, password change 10.

## 7. Open human tasks

- [ ] `operator-rule-gaps` ticket 03: the Terms page still promises that Campaigns get deleted. This is legal copy.
- [ ] `campaign-status-transitions` ticket 11: backfill legacy Suspensions (§4).
- [ ] prd-compliance tickets 06–08: decide who may create a Campaign (the CAMPAIGN_CREATOR meaning), then retire the Role hierarchy. After the assignments move, the Role editor and its "Moderator" and "Admin" options no longer grant anything.

## 8. Added on 26 September (afternoon)

- **Next image optimizer is off** (ci-cd 13, PR #21): `/_next/image` answers 404 and images are served from their original URL, without resizing or WebP. This is the stopgap for the critical RCE GHSA-2xp9-vwfh-vxw4. The Next upgrade (ci-cd 15) must land before **2026-10-10**, when the `.trivyignore` entry expires.
- **Verification outcome email** (prd-compliance 13, PR #19, merged 32ffdd9): the SMTP env vars must be in the production `.env` (see ci-cd 08). Without them decisions still go through, but no email is sent.
- **Field encryption** (prd-compliance 15, PR #25): the production `.env` needs `FIELD_ENCRYPTION_KEY`, `FIELD_ENCRYPTION_KEY_ID`, `FIELD_HMAC_KEY` and `FIELD_HMAC_KEY_ID`, all four together. Generate each key separately with `openssl rand -base64 32`. Without them the app runs as before, writing plaintext only, with a boot warning. A partial set stops the app from starting. **Back up the keys outside the host:** losing them makes the ciphertext unreadable.
- **nginx (2026-09-26):** a stopgap blocks `/_next/image` on fundforindonesia.org and galang.fundforindonesia.org, and the main domain gets `client_max_body_size 8m`. Backups are in `/etc/nginx/backup-ffi-20260926/`. Remove the `/_next/image` block after the cutover.
- **Permit gate** (prd-compliance 10, PR #26): after the deploy, **every existing Active Campaign refuses Donations** until an Admin or Verifier assigns a Collecting Entity with a permit valid for its Kind, at `/admin/collecting-entities` or `/moderasi/collecting-entities`. First register YIEM and its permit at `/moderasi/partner-organisations` (percepatan-produksi 02). No impact while `NEXT_PUBLIC_DONATIONS_ENABLED=false`.
- **Deploy workflow** (ci-cd 07, PR #27): `.github/workflows/deploy.yml`, dispatched by the owner. The repo secrets `DEPLOY_HOST`, `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` are needed first (see ci-cd 08).
- **Kind Authorisation** (prd-compliance 11, PR #32): zakat, wakaf and hibah Campaigns also need their Collecting Entity to hold a valid Kind Authorisation for that Kind. It is granted at `/moderasi/partner-organisations`. An individual Fundraiser may only run Donation Campaigns.
