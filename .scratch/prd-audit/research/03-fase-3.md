# 03: Fase 3 compliance -- research findings

Audited against `origin/main` at `c19f2eba89c460e5ad812df17bea2b306fbbe81e`
(confirmed identical to this branch's `src/` and `prisma/` via
`git diff --stat origin/main HEAD -- src/ prisma/`, empty). Read-only: grep and
Read only, no tests run, no scripts executed.

Evidence standard applied throughout (`.scratch/prd-audit/map.md`): a
user-run requirement is ✅ only with code + test + a screen it is reachable
from. Code with no screen is 🟡. A backend-only rule needs code + test only.

## Q1 -- The Fase 3 gate: Volunteer Trip end to end to a certificate, one Batch with a real Trip Fee, one Refund Trip Fee

**Verdict: 🟡 the money path is built and wired end to end at the API layer;
the gate fails on two independent grounds -- no screen anywhere reaches any
of it, and the certificate has zero code.** Also see the ⚠️ in Q4: the
Trip Fee charge path has no equivalent of the Donation path's
`donationsEnabled()` / `sandboxInProductionReason()` switch, so "a real Trip
Fee" today means whatever `PAYMENT_PROVIDER` happens to be set to, with none
of the production interlock the Donation path has.

### What exists (code + test, no screen)

- **Trip CRUD and lifecycle** -- `src/lib/volunteer/trip.ts`. `submitTrip`
  (:160-185, Draft/Rejected -> Submitted), `decideTripSubmission`
  (:220-254, Verifier approve/reject -> Active/Rejected, locks the Trip,
  judges Capacity, logs `VolunteerTripStatusChange`, notifies the
  Fundraiser). Tested: `src/lib/volunteer/trip.test.ts`.
- **Trip creation route** -- `src/app/api/volunteer-trips/route.ts:31-62`
  (`POST`, any signed-in user, matches PRD FFI-04 "anyone registered may
  create"), `:64-97` (`GET`, public catalog, `status: 'ACTIVE'` only).
  Tested: `src/app/api/volunteer-trips/route.test.ts`.
- **Verifier moderation** -- `src/app/api/moderasi/volunteer-trips/route.ts:6-13`
  (`GET`, `Assignment.VERIFIER`, queue of `SUBMITTED` trips) and
  `src/app/api/moderasi/volunteer-trips/[id]/route.ts:15-39` (`PATCH`,
  approve/reject). This closes the exact "both ends unreachable" gap
  `.scratch/rilis-1-benda/issues/09-volunteer-in-rilis-1.md` (lines 15-31,
  19-26) found on 2026-09-27: a screen-less API endpoint now exists on both
  the creation and the moderation side. Tested:
  `src/app/api/moderasi/volunteer-trips/route.test.ts`,
  `.../[id]/route.test.ts`.
- **Batch CRUD and cancellation** -- `createBatch` (trip.ts:309-375),
  `editBatch` (:376-399), `completeBatch` (:400-411), `cancelBatch`
  (:449-483, refunds every live Registration in full per
  `BatchCancelRefund`, refuses with `BatchMinQuotaMetError` (:457) if
  `minQuota` was actually reached -- matching CONTEXT.md's Volunteer Batch
  entry that only an unmet minimum cancels a Batch). Wired at
  `src/app/api/volunteer-trips/[slug]/batches/route.ts` and
  `.../batches/[id]/route.ts:52-64` (`action: 'cancel'|'complete'`).
  Tested: `src/lib/volunteer/trip-batches.test.ts` (19KB),
  `src/app/api/volunteer-trips/[slug]/batches/route.test.ts`,
  `.../batches/[id]/route.test.ts`.
- **Registration + Trip Fee charge** --
  `src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.ts`:
  holds a seat via `holdRegistration` (trip.ts:524-562, locks Trip -> Batch,
  expires lapsed holds, checks quota and one-registration-per-Volunteer),
  then charges through the same `getPaymentProvider()` /
  `provider.createCharge()` used by Donations (route.ts:85-159), writes a
  `Payment` with `registrationId` set and `platformFee` left at its schema
  default (`prisma/schema.prisma:1301` -- "Always 0 for a Trip Fee Payment").
  `escrowHoldDays` is explicitly the same `ESCROW_HOLD_DAYS` constant as
  Donations (route.ts:142-155), which resolves
  `.scratch/rilis-1-benda/issues/09-volunteer-in-rilis-1.md`'s open question
  "What `escrowHoldDays` is for a Trip" (line 73-75) -- by code, not by a
  spec decision anyone signed off on. Tested:
  `src/lib/volunteer/trip-registrations.test.ts` (14KB),
  `.../registrations/route.test.ts`.
- **Settlement wiring** -- `src/app/api/webhooks/[provider]/route.ts` calls
  `confirmRegistration` (:351), `refundLateSettlement` (:544),
  `expireRegistrationHold` (:648), all three defined in
  `src/lib/volunteer/trip.ts:709-757`, matching the three Trip Fee Refund
  cases in `src/lib/volunteer/refunds.ts`.
- **Trip Fee Refund policy** -- `src/lib/volunteer/refunds.ts`.
  `tripFeeRefundAmount` (:19-30): >=14 days before departure = full refund,
  3-13 days = half (rounded down), <3 days = none. `tripFeeRefund` (:50-70)
  dispatches the three cases: `'volunteer cancel'` (tiered),
  `'batch cancel'` (always full), `'late settlement'` (always full). The
  file's own comment (refunds.ts:6-10) states these thresholds are
  **code's own invention, not a spec value** -- this answers PRD pasal 13's
  open item "Ambang hari tepat untuk setiap tingkat Refund Trip Fee ...
  Didorong ke penulisan spec" (PRD-fund-for-indonesia.md:379) in code only,
  never in spec or by owner sign-off. Tested: `refunds.test.ts`.
- **Registration cancellation by the Volunteer** -- `cancelRegistration`
  (trip.ts:662-687): only the owning Volunteer, HOLD cancels free,
  CONFIRMED triggers `refundTripFee` with case `'volunteer cancel'`. This
  answers a second `.scratch/rilis-1-benda/issues/09-volunteer-in-rilis-1.md`
  open question, "Whether a Batch's minimum quota is enforced at
  registration or at closing" (line 67-70) for the Batch side (enforced at
  `cancelBatch` time, refused if the minimum was already met -- no
  automatic sweep or warning as the deadline approaches; that part is still
  unanswered).
- **HOLD window** -- `HOLD_WINDOW_MS = 30 * 60 * 1000` (trip.ts:484), with
  its own comment "An open parameter: no spec value pins it" (:481-482).
  Answers `.scratch/rilis-1-benda/issues/09-volunteer-in-rilis-1.md`'s open
  question on hold-window length (implied at lines 68-70) and PRD pasal
  13's "Lama jendela penahanan kursi ... " (PRD-fund-for-indonesia.md:380)
  -- again in code only, not signed off.
- **Trip Payout** -- `src/app/api/volunteer-trips/[slug]/payouts/route.ts`
  (POST/GET, Fundraiser-only, sweeps escrow via `releaseMaturedEscrow`
  first, mirrors the Campaign payout route exactly per its own comments),
  `.../payouts/[id]/approve/route.ts` (Admin, two-person rule reused from
  `approvePayout`, requires a manually-read provider balance -- same
  discipline as Campaign Payout), `.../payouts/[id]/complete/route.ts`
  (second, different Admin, requires `proofImage`). All three explicitly
  documented as sharing `src/lib/money/payouts.ts`'s subject-agnostic logic
  with Campaign, not a Trip-specific reimplementation.
- **Trip Refund approval** --
  `src/app/api/volunteer-trips/[slug]/refunds/[id]/approve/route.ts`
  (Admin, `approveRefund` shared with Campaign, scoped by checking
  `refund.payment.registration.batch.tripId === trip.id`).
- **Impact & Transparency correctly excludes Trip Fee** --
  `src/lib/money/impact.ts:218-321` scopes every ledger read to
  `campaignId: { in: campaignIds }`; a Trip Fee `Payment` carries
  `registrationId`, never `campaignId`, so it cannot enter any of the six
  Impact lines. Matches ADR 0014 and CONTEXT.md's Trip Fee entry
  ("Trip Fee tidak pernah appear in a Campaign's totals, a Receipt, or a
  Donor-facing number" -- issue 09 answer, lines 52-56).
- **Locking discipline documented and self-consistent** -- trip.ts:40-81's
  header comment states the lock order (Trip -> Batch -> Registration ->
  Payment) and names the properties tests that pin it
  (`src/__tests__/properties/registration-status-single-writer.test.ts`,
  `subject-lock-single-owner.test.ts`) -- not independently re-verified
  here (out of scope: reading test assertions, not running them, would be
  needed to confirm the property actually holds; treating the comment's
  claim as ✅ without reading those two files would violate the evidence
  standard, so this item is left unscored).

### What is reachable (only barely, and only for someone who already knows the URL)

- Every route above requires a session and, for Verifier/Admin actions, an
  `Assignment`, so authorization is real. But there is no page that ever
  issues a request to any of them.

### What is missing

- **No screen at all.** `grep -rli "volunteer" src/app --include='*.tsx'`
  and the same over `src/components` return nothing except one line:
  `src/components/home/QuickActionTiles.test.tsx:112` pins a homepage tile
  `{ icon: "✨", label: "Volunteer", comingSoon: true as const }` -- the
  *only* place "Volunteer" appears in any renderable component, and it is a
  disabled placeholder. There is no Trip catalog page, no Trip detail
  page, no Batch picker, no Registration flow, no Volunteer dashboard
  section, no Verifier moderation screen. Every route in the previous
  section is a bare `fetch` target nobody's UI calls.
  - Corroborating: `decideTripSubmission` (trip.ts:249) builds a
    notification `link: '/volunteer-trip/${updated.slug}'` for the
    Fundraiser -- a page that does not exist (`find src/app -type d
    -iname '*volunteer*'` returns only `src/app/api/volunteer-trips` and
    `src/app/api/moderasi/volunteer-trips`, no non-API directory). A
    Fundraiser who clicks that notification link gets a 404.
- **Certificate: zero code.** `grep -rn "sertifikat|certificate" src/`
  (case-insensitive) returns nothing anywhere in `src/`, tests included.
  No model, no route, no generation logic, no template. This is a
  complete ❌, not a 🟡 -- there is no code to point a screen at even in
  principle. `.scratch/rilis-1-benda/issues/09-volunteer-in-rilis-1.md`
  flagged this as unresolved on 2026-09-27 (lines 62-65, "Where the
  certificate comes from ... unasked"); nothing has changed since.
- **No Trip suspension.** `VolunteerTripStatus.SUSPENDED` and `CANCELLED`
  exist in the enum (`prisma/schema.prisma:1995-2003`) and `SUSPENDED` is
  referenced once, only as a status a Batch may still be added under
  (trip.ts:278). No function in `trip.ts` ever transitions a Trip to
  `SUSPENDED`, `CANCELLED`, or `COMPLETED` -- only `SUBMITTED`/`ACTIVE`/
  `REJECTED` are ever written (`grep -n
  "VolunteerTripStatus\.(SUSPENDED|CANCELLED|COMPLETED)"` on the write
  sites finds none). An Admin has no way to suspend a Volunteer Trip the
  way FFI-07b lets them suspend a Campaign. Not one of the four things the
  gate names explicitly, but a real gap in the "no half-open loop" rule
  `.scratch/rilis-1-benda/issues/09-volunteer-in-rilis-1.md` set (line
  47-51): abuse response exists for Campaign and not for Trip.
- **No identity-verification link for a Volunteer Trip's Fundraiser.**
  Campaign's `decideVerificationRequest` creates an `IdentityVerification`
  row on first approval (`src/lib/campaign-lifecycle.ts:942-953`).
  `decideTripSubmission` (trip.ts:220-254) does none of this. CONTEXT.md's
  Fundraiser entry says identity verification happens "pada pengajuan
  pertamanya" for either a Campaign or a Volunteer Trip (CONTEXT.md:79,
  114); today only the Campaign path fulfils that promise. A Fundraiser
  whose first-ever submission is a Volunteer Trip is never identity-checked
  by this mechanism.

## Q2 -- Non-gate Fase 3 items: status and rough size

| Item | Status | Evidence | Size |
| --- | --- | --- | --- |
| Versi bahasa Inggris (i18n) | ❌ not started | No i18n library in the tree: `grep -rn "i18n\|next-intl\|locale" src/ package.json` finds nothing relevant (one false-positive hit, `localeCompare` in `src/app/api/admin/scrutiny/route.ts:80`, unrelated). No language switcher, no translation-key infrastructure despite PRD §9 saying the i18n approach was meant to be picked at Fase 1 "agar halaman baru ditulis dengan kunci terjemahan sejak awal" -- that decision was never acted on in code. | L -- full i18n plumbing plus translating every page and Campaign/Program field |
| Notifikasi WhatsApp | ❌ not started | The only WhatsApp code is a `wa.me` share-link button in `src/components/shared/ShareModal.tsx:34-44` (FFI-06, Fase 1 sharing) -- not WhatsApp Business API, not a notification channel. No WhatsApp Business API client, template, or webhook anywhere in `src/`. | M -- WA Business API integration, template approval, a new notification channel alongside email |
| Tautan pendek | ❌ not started | `grep -rli "short.*link\|shortlink\|tautan pendek" src/` returns nothing. | S -- a redirect model/table and a resolver route |
| Impor settlement otomatis | ❌ not started | `grep -rli "settlement.*import\|import.*settlement\|reconciliation.*import" src/` returns only a webhook test file name coincidence (`route.test.ts`), no actual import/parsing code. Reconciliation today is the fully-manual process PRD §9 describes ("Rekonsiliasi harian sepenuhnya manual"). | M -- parse each provider's settlement report format, match against the ledger, surface discrepancies |
| Pengalihan Dormant Balance | ❌ not started | Confirmed by CONTEXT.md itself (CONTEXT.md:240, "Belum ada kodenya sama sekali") and independently: `grep -n "model UsageReport\|model DormantBalance\|Dormant" prisma/schema.prisma` finds nothing; `src/lib/scheduled-jobs.ts:51` only comments "Dormant Balance is unbuilt". The 60-day *report* (Fase 2 item, PRD §7.3) is a separate, already-shipped piece not in scope here. | M -- transfer workflow, two-person rule, Donor notification, permanent record on the origin Campaign |
| Refund yang diminta Donor | ❌ not started | PRD §7.2 is explicit that today "Donor tidak bisa memulai Refund sendiri lewat antarmuka" (PRD-fund-for-indonesia.md:170) and that remains true: every Refund-creation code path (`src/lib/money/refunds.ts` and its Campaign/Trip routes) takes `requestedById` from an authenticated Admin session via `withAssignmentCheck(Assignment.ADMIN, ...)`, never from a Donor-facing route. No Donor-facing refund-request route exists in `src/app/api`. | M -- Donor-facing request form/route, still landing in the existing Admin-approval state machine (`RefundStatus` already has all the states, `prisma/schema.prisma:1115-1123`) |
| Anggota tim Fundraiser organisasi | ❌ not started | `grep -rli "team member\|anggota tim\|OrganisationMember\|TeamMember" src/ prisma/schema.prisma` returns nothing. A Partner Organisation today is "satu akun Fundraiser yang bertindak atas namanya" (CONTEXT.md:102), with no second user able to act for it. | M/L -- new membership model, permission scoping per organisation account, invite flow |

## Q3 -- §12-14: risks, open questions, deck notes -- answered or still open

**§12 Risiko** (PRD-fund-for-indonesia.md:328-339): every risk row concerns
Fase 0-2 mechanics (Campaign abuse, Kind Authorisation expiry, Sumopod
QRIS-only, Provider Balance drift, verification throughput, legacy demo
data, parallel Makam.co.id work, Hibah's borrowed Wakaf rules) and none
name Volunteer/Fase 3 directly, so none are newly answered or reopened by
this audit. All were already addressed or explicitly tracked as open in
the document itself; no code contradicts any of them.

**§13 Pertanyaan terbuka** (PRD-fund-for-indonesia.md:343-382):

- Decided 19/22 Sep, all `[x]` -- not re-checked here (out of this
  ticket's Fase 3 scope except where cited above).
- Hibah's two open items (lines 374-375, syariah review of Refund/Kind
  Authorisation/documents pattern, and amil/nazhir-equivalent terms) --
  **still open**, no code or ADR closes them; ADR 0013 itself says the same.
- Volunteer Trip's two open items (lines 377-380):
  - "Ambang hari tepat untuk setiap tingkat Refund Trip Fee ... dan nilai
    default kuota minimum Batch" -- **answered by code only**, not by spec
    or owner sign-off: see `tripFeeRefundAmount` (refunds.ts:19-30, 14/3-day
    tiers) above. `minQuota`'s "default value" is not answered at all --
    there is no default; `minQuota` is a required, Fundraiser-set field per
    Batch with no platform-wide fallback (`createBatch`, trip.ts:309+, and
    the Zod schema in `batches/route.ts` -- not inspected line-by-line here
    but no constant resembling a minQuota default appears anywhere in
    `trip.ts`).
  - "Lama jendela penahanan kursi" -- **answered by code only**:
    `HOLD_WINDOW_MS` (trip.ts:484), same caveat as above.
- The legal-counsel item (line 382, PT-vs-yayasan fundraising-permit
  mismatch) is explicitly "di luar dokumen ini" and not a code question.

**Pasal 14 catatan deck**: purely a change-log/traceability section against
the original deck; nothing there names an unresolved Fase 3 item beyond
what's already covered above (Hibah-for-Volunteer menu swap, CSR move to
Fase 1, Trip Fee's late addition as a paid model). Nothing here is newly
answered or contradicted by code.

## Q4 -- PRD-wide ⚠️ sweep

### ⚠️ Volunteer Trip Fee registration has no money switch or production interlock -- the exact case the ticket calls out

The Campaign Donation path is deliberately gated twice before it ever calls
`getPaymentProvider()`:

- `donationsEnabled()` (`src/lib/donations.ts:28-30`): off unless
  `NEXT_PUBLIC_DONATIONS_ENABLED === 'true'` exactly.
- `sandboxInProductionReason()` (`src/lib/donations.ts:55-59`): in
  `NODE_ENV=production`, refuses to charge through a provider
  `src/lib/payments/production-readiness.ts`'s per-provider rule marks
  unsafe for production (e.g. `mock`, or a `sumopod` env pointed at a
  sandbox base URL) -- the file's own comment explains why: "Sandbox
  credentials left in production take real rupiah into an account that
  settles nowhere ... There is no recovery path" (`donations.ts:41-44`).

`grep -n "donationsEnabled\|sandboxInProductionReason" -r src/ | grep -v test`
shows both are called from exactly three places: `POST /api/donations`
(`src/app/api/donations/route.ts:56,64`), the donation retry route
(`src/app/api/donations/[id]/retry/route.ts:36,40`), and the donate page's
client-side message (`src/app/campaign/[slug]/donate/page.tsx:150`).

**The Volunteer Trip Fee charge route calls neither.**
`src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.ts`
imports `getPaymentProvider` directly (line 5) and calls it unconditionally
(line 52, inside a `try`/`catch` that only handles
`PaymentProviderNotConfiguredError`) before charging
`provider.createCharge(...)` at line 106. There is no `donationsEnabled`-
equivalent switch for Trip Fee collection, and no `sandboxInProductionReason`
check before the charge.

Consequences, both real given the module is otherwise wired end to end:

1. **The global donation kill-switch does not cover Trip Fees.** If an
   operator sets `NEXT_PUBLIC_DONATIONS_ENABLED=false` believing this stops
   all public money collection (its own doc comment says "off unless
   somebody turns it on" -- `donations.ts:7`), Volunteer registrations can
   still charge real money through whatever `PAYMENT_PROVIDER` is
   configured, because that route never reads the flag.
2. **The production sandbox interlock does not cover Trip Fees.** The
   scenario `sandboxInProductionReason` exists specifically to prevent --
   `NODE_ENV=production` with `PAYMENT_PROVIDER` still pointed at a sandbox
   or the `mock` adapter -- is exactly as possible on the Registration route
   as it is on the (protected) Donation route, with the same stated
   consequence: a Volunteer pays, the webhook never truly settles against a
   real merchant account, and the money is "simply gone as far as this
   platform can tell" (`donations.ts:42-43`, describing the exact case this
   route leaves open).

This is the PRD/ADR-relevant harm directly: ADR 0014 and CONTEXT.md's Trip
Fee entry both insist Trip Fee reuses "the same" Payment/Escrow
Hold/Payout rails as Donation "as shared money-movement primitives"
(ADR 0014, Consequences) -- but the safety rail the Donation rail actually
has was not carried over with it.

### Other items checked, no violation found

- **Platform Fee on Trip Fee**: `Payment.platformFee` defaults to `0`
  (`prisma/schema.prisma:1301`) and the registration route never sets it,
  so it is always 0 for a `registrationId`-bearing Payment -- matches
  CONTEXT.md's Trip Fee entry ("Tidak dipotong Platform Fee") and PRD §10.
- **Impact & Transparency**: confirmed above (Q1) that Trip Fee payments
  never enter any of the six lines, matching ADR 0014's "must never appear
  in a Campaign's totals, a Receipt, or a Donor-facing number".
- **Refund's flat-Gross rule (ADR 0007) correctly not applied to Trip Fee**:
  `src/lib/volunteer/refunds.ts` implements its own tiered/full rules
  entirely separately from `src/lib/money/refunds.ts`'s Campaign path,
  never importing or reusing ADR 0007's Gross-refund percentage logic.
- **Two-person rule on Trip Payout/Refund**: both routes explicitly reuse
  `approvePayout`/`completePayout`/`approveRefund` from
  `src/lib/money/payouts.ts` and `src/lib/money/refunds.ts`, the same
  subject-agnostic functions Campaign uses, so the same two-different-
  Admins enforcement applies without a Trip-specific carve-out.
- **Donor-initiated Refund**: checked and confirmed still absent (Q2
  table) -- consistent with, not contradicting, PRD §7.2's explicit "Donor
  tidak bisa memulai Refund sendiri" statement, so this is a scope gap, not
  a PRD-violation.
- **Usage Report / Dormant Balance "not built" claims in CONTEXT.md**:
  independently re-verified against `prisma/schema.prisma` and
  `src/lib/scheduled-jobs.ts` -- both confirmed absent, matching
  CONTEXT.md's own text exactly (no discrepancy between CONTEXT.md and the
  code it describes).

No other money path was found that accepts money without a switch: the
only two payment-collection entry points in `src/app/api` that call
`getPaymentProvider()`/`provider.createCharge()` are `POST /api/donations`
(guarded) and `POST /api/volunteer-trips/[slug]/batches/[id]/registrations`
(unguarded, above). Manual Contribution
(`src/app/api/admin/manual-contributions` -- not read in full this pass)
does not go through a Payment Provider at all by definition (CONTEXT.md,
Manual Contribution: "di luar payment gateway"), so it is out of scope for
this specific sweep.
