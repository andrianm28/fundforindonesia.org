# 38: Abuse thresholds and audit markers

**What to build:** Scrutiny scales with the amount at stake, without blocking anyone mid-donation.

**Blocked by:** 12, 18

**Status:** done (PR #88, b3a34f1)

- [x] Cumulative Gross above Rp100 juta on a Campaign triggers additional Verifier review
- [x] Above Rp500 juta places an audit marker on the Campaign
- [x] A single Donation above Rp50 juta is flagged for an Admin without being blocked
- [x] At most three Active Campaigns before a Fundraiser's first Usage Report is accepted
- [x] Thresholds are configurable, not hardcoded

## Comments

- 2026-09-28 (ticket 38): the four limits live in one place,
  `src/lib/abuse-thresholds.ts` (`AbuseThreshold`, append-only, latest row per
  kind in force, PRD's numbers as the defaults), set by
  `POST /api/admin/abuse-thresholds`. **Deliberately not the same table as the
  duplicate-hint threshold**: that one is a `pg_trgm` score compared between two
  Campaigns at review time (prd-compliance 14), these are rupiah amounts and a
  Campaign count compared against money that has settled. Two questions, two
  tables, and the CONTEXT.md entry for Petunjuk Duplikat says so. The one
  mechanism they share is the checklist snapshot: an amount review takes the
  same per-Kind snapshot a submission does, so the "bukan duplikat" item
  applies to a large Campaign too, rather than a second checklist.

- **Who evaluates what, and when.** The System, at Settlement, inside the
  settlement's own transaction: `evaluateSettledDonationScrutiny` runs in
  `POST /api/webhooks/[provider]` right after `collectedAmount` is incremented
  (src/lib/scrutiny.ts). Evaluating only where a human looks was the alternative
  and it does not work: a Campaign's Cumulative Gross is 0 while it waits to be
  approved, so a review-trigger read from the Verifier queue would never fire,
  and a read from an Admin dashboard would fire whenever that Admin got round
  to it -- the timing an abuser picks. The three consequences are a marker on the
  Donation, an audit marker on the Campaign, and a Verifikasi Tambahan. Nothing
  is refused, held or reversed; the only lever that still stops a Campaign is
  Suspension, which stays a person's decision (ADR 0015).

- **Verifikasi Tambahan is a third kind of Verification Request**, not a parallel
  mechanism: `VerificationRequestKind` (SUBMISSION / CHANGE / AMOUNT_REVIEW) with
  the migration backfilling CHANGE from `proposedChanges`, so it lands in the
  existing Verifier queue, is decided through `decideVerificationRequest` with
  the existing checklist, and records who and when. It moves no status either
  way, notifies the Fundraiser in-app but emails nobody, can be decided after
  the Campaign has closed (the money arrived while it was open), and the
  Fundraiser cannot withdraw it (`AMOUNT_REVIEW_NOT_WITHDRAWABLE`). At most one
  per Campaign, ever: the crossing Donation raises it, and the lifecycle's check
  under the Campaign row lock is what makes two simultaneous settlements
  produce one. The moderasi page says why the request is open and shows the
  Gross and the threshold it was raised at.

- **The three-Active-Campaign limit is enforced at the approval that would open a
  fourth** (`TOO_MANY_ACTIVE_CAMPAIGNS`, 409; the request stays PENDING and the
  Campaign stays Submitted). Nothing collecting is touched. The PRD's escape is
  the Fundraiser's first Usage Report, and **no Usage Report exists yet
  (prd-compliance 29)**, so today the only way past the limit is one of the
  first three leaving Active on its own (deadline, Completed, Cancelled,
  Suspended). The refusal says exactly that, and does not promise a Usage Report
  escape that does not exist yet. Two limits on that rule, stated rather than
  hidden: the count is read under this Campaign's row lock, not the sibling
  Campaign's, so two approvals committed at the same instant can both pass and
  leave a Fundraiser with four Active Campaigns (never a wrong count, never
  money moving); and locking the Fundraiser's User row was rejected as a second
  lock order for a ceiling on parallel appeals. `GET /api/admin/scrutiny` lists
  the Fundraisers already at the limit, so the rule is visible before a Verifier
  hits it.

- **Left out on purpose.** No marker here is dismissible: an Admin reads the
  markers and a Verifier decides the review, and there is no "clear this" write
  anywhere, because a marker whose only purpose is to be read at audit does not
  need one. Gross that arrives by a route this slice does not read -- a Manual
  Contribution, prd-compliance 34 -- is not judged here; a Campaign that crosses
  Rp100 juta without a single Donation settling never earns its review. Both are
  the same gap with one fix: a scheduled sweep over Campaigns already above a
  limit, which is where `runScheduledJobs` (prd-compliance 20) is the right home.

- **Overlap checked, nothing duplicated.** `POST /api/partnership-inquiries`
  (PR #71) is public and unguarded, and csr-and-hibah/06b owns that. This ticket
  does not touch it and does not add a rate limiter: a spam guard is a bound on
  how often one source may post, while everything here is a comparison against
  money that has arrived, and the two share no store, no table and no code.

- **Migration** `20260928100000_abuse_thresholds`: three new tables, the
  VerificationRequest kind column with its backfill, and `submittedById` made
  nullable because the System raises a request and is not a person. The
  `isChangeRequest` derivation moved from "has a proposal" to the kind column;
  the backfill is exactly that rule, so no row changed meaning. Both enums are
  created before the `ALTER TABLE` that names one of them -- the first CI run
  failed on exactly that (42704, type does not exist) in all three jobs that
  migrate a database.
