# Spec: PRD compliance, Fase 0 through Fase 2

Status: ready-for-agent
Source: PRD `docs/PRD-fund-for-indonesia.md` (revisi 19 September 2026), `CONTEXT.md`, ADR 0001–0012.

## Problem Statement

Fund for Indonesia presents itself as a platform that unites donasi, zakat, wakaf, CSR
and volunteer in one account with one impact history. Today almost none of that is true
for the people it is meant to serve.

A Donor cannot give: donations are switched off behind a kill-switch because no real
Payment Provider was wired up. If they could give, no Receipt would ever arrive, because
the platform cannot send email at all. A Fundraiser cannot be paid: there is no Payout
screen anywhere, and a Payout that is approved stops at APPROVED because nothing marks it
Completed. An Admin cannot return money: there is no Refund endpoint, and the ledger
refuses to refund more than Net, which contradicts the promise that a Donor gets back
exactly what they paid. The Platform Operator earns nothing: `PLATFORM_FEE` exists in the
ledger enum and is never posted to.

Beyond the money, the concepts the whole product is built on are missing. There is no
Kind, so zakat and wakaf are a page and a free-text string rather than money rules. There
is no Kind Authorisation, no Partner Organisation, no Collecting Entity, so nobody can say
under whose licence a Campaign collects — which is the one question that must be answered
before the platform takes a single rupiah from the public. There is no Verification
Request, so a Verifier's decision leaves no record and no history of rejections. There is
no Usage Report, so "transparansi sebagai fitur" has nothing to show.

The result: the platform can display Campaigns and collect nothing, or collect money it
cannot pay out, refund, or account for.

## Solution

Deliver Fase 0, Fase 1 and Fase 2 of the PRD so that money can enter the platform, be
accounted for, and leave it again — in every direction, under the two-person rule, with a
record at each step.

Three arcs, in order, each of which leaves the platform in a coherent state:

**Fase 0, fondasi.** Give the domain its spine. Campaign gains a real lifecycle
(Draft → Submitted → Rejected/Active → Suspended/Cancelled/Completed/Expired) instead of a
free-text string, and a Kind that decides its money rules. A Campaign names its Collecting
Entity, which must hold an unexpired Fundraising Permit for that Kind or the Campaign
cannot open (ADR 0010). Verification Request becomes an entity with a document checklist,
a reason for rejection and an audit trail, and every resubmission creates a new one.
Verifier and Admin become separate assignments rather than a rank (ADR 0005).
Transactional email stands up, because a verification result that never reaches the
Fundraiser is not a decision. The wallet is removed and AutoDonation is parked.

**Fase 1, MVP.** Turn on real money. Sumopod QRIS collects Donations through the existing
provider-neutral layer; Provider Fee is read from the payload and Platform Fee is finally
computed and posted, configurable per Kind with overrides per Category and per Campaign,
waived below a threshold. Every Payment freezes the Platform Fee, Provider Fee and Escrow
Hold that applied when it was created, so the promise a Donor saw cannot change after they
pay. Receipt reaches the Donor by email, with Akad Wakaf alongside it for Kind `wakaf`.
Escrow Hold is anchored to the provider's settlement, not to server time, and matures on a
schedule rather than only when someone happens to request a Payout. Impact & Transparency
shows the six-line breakdown that must sum exactly to the amount collected.

**Fase 2, pendalaman.** Complete the money-out paths. A Fundraiser requests a Payout and a
second Admin marks it Completed with proof of transfer, which finally drains
`PAYOUT_CLEARING` and credits the Provider Balance. Usage Report becomes an entity that
gates the next Payout. Suspension and Cancellation work, and Refund works end to end at
Gross with the Provider Fee absorbed by the platform (ADR 0007), including the partial,
per-Kind and shortfall cases. Manual Contribution records money that arrived outside the
gateway. Donor anonymisation, the Dormant Balance report and a second provider complete
the phase.

## User Stories

### Donor and Guest Donor

1. As a Donor, I want to give to a Campaign without creating an account, so that giving takes minutes rather than a signup.
2. As a Donor, I want quick amount choices and a free amount above Rp20.000, so that I can give what I intend without arithmetic.
3. As a Donor, I want donations below Rp50.000 to carry no Platform Fee, so that a small gift is not eaten by charges.
4. As a Donor, I want to see the Platform Fee, the Provider Fee and the Escrow Hold before I pay, so that I know what reaches the Campaign.
5. As a Donor, I want the fees and hold I was shown to be the ones that apply, even if an Admin changes the defaults tomorrow, so that the promise I saw is the promise kept.
6. As a Donor, I want to pay by QRIS, so that I can give with the wallet I already use.
7. As a Donor, I want to retry payment after a failure or expiry without starting over, so that one bad attempt does not cost me the donation.
8. As a Donor, I want my Payment to expire after 24 hours rather than hang forever, so that I am not left uncertain.
9. As a Donor, I want a Receipt in my email after Settlement, so that I have proof I gave.
10. As a Donor, I want to reopen and print my Receipt later, so that I can use it for my own records.
11. As a Donor, I want to give anonymously, so that neither the public nor the Fundraiser sees who I am.
12. As a Donor, I want to leave a Prayer with my Donation, so that I can send support as well as money.
13. As a Donor, I want Campaign Updates by email, so that I learn what my money did.
14. As a Guest Donor, I want to claim my giving history after registering with the same email, so that my past gifts are not lost — but only once that email is verified, so that nobody can claim mine.
15. As a Donor, I want to ask for my identity to be removed, so that my name and contact details stop being held after I no longer want them held.
16. As a Wakif, I want an Akad Wakaf document per Donation, so that my pledge is recorded as the practice requires.
17. As a Wakif, I want to confirm the ikrar by checkbox at checkout, so that the pledge is explicit rather than assumed.
18. As a muzaki, I want a zakat calculator, so that I know how much is due before I pay it.
19. As a Donor, I want to know a Campaign is a Demo Campaign and cannot take money, so that I do not try to give to something fictional.
20. As a Donor whose Campaign turned out to be fraudulent, I want the full amount I paid returned, not that amount minus a processing fee, so that I am not charged for someone else's abuse.
21. As a Donor owed a Refund, I want a private link to submit my bank account, so that I can be repaid without exposing anything else.
22. As a Donor owed a Refund, I want a fresh link if mine expires, so that a missed email does not cost me my money.
23. As a Donor, I want email when a Refund is created, when my account details are needed, and when the money is sent, so that I am never left wondering.

### Fundraiser

24. As a Fundraiser, I want to save a Campaign as a Draft, so that I can finish it later.
25. As a Fundraiser, I want to submit a Draft for verification, so that it can be published once it is trusted.
26. As a Fundraiser, I want to know exactly which documents my Kind requires, so that I am not rejected for something I could have supplied.
27. As a Fundraiser, I want a rejection to arrive with its reason by email, so that I can fix the actual problem.
28. As a Fundraiser, I want to revise and resubmit without limit, so that a first refusal is not final.
29. As a Fundraiser, I want to withdraw a Verification Request while it is still undecided, so that I can correct a mistake before someone wastes time on it.
30. As a Fundraiser, I want my Campaign to keep running on its old values while a change to its target, deadline or Bank Account is re-verified, so that re-verification does not cost me donations.
31. As a Fundraiser, I want share buttons and a preview image, so that my Campaign travels well on social media.
32. As a Fundraiser, I want to see which shared link brought which Donations, so that I know where to put my effort.
33. As a Fundraiser, I want to post a Campaign Update to all my Donors, so that they see progress.
34. As a Fundraiser, I want to see my Escrow Hold and my Campaign Balance separately, so that I know what I can actually request.
35. As a Fundraiser, I want to request a Payout of part of my Campaign Balance while the Campaign is still Active, so that I can spend as needs arise.
36. As a Fundraiser, I want to see the status of my Payout, so that I am not left guessing whether money is coming.
37. As a Fundraiser, I want to submit a Usage Report for a completed Payout, so that my Donors see what the money did.
38. As a Fundraiser, I want to know that a Usage Report is required before my next Payout, so that the rule is not a surprise.
39. As a Fundraiser, I want to keep what I raised when I miss my target, so that a partially funded need is still met (ADR 0004).
40. As a Fundraiser, I want to withdraw my Campaign honestly through Cancellation, so that I am not shown to the public as though I had been suspended.
41. As a Fundraiser, I want to see Donations without the identities of anonymous Donors, so that I can thank people without breaching their choice.
42. As a Fundraiser whose Campaign received a Refund, I want to be told and to see the effect on my Campaign Balance, so that my planning reflects reality.

### Verifier

43. As a Verifier, I want a queue of Verification Requests, so that I know what is waiting.
44. As a Verifier, I want a document checklist per Kind, so that I check the same things every time.
45. As a Verifier, I want up to five similar Campaigns surfaced — same Fundraiser, similar title, identical beneficiary name — so that I can catch duplicates and fraud.
46. As a Verifier, I want to verify a Fundraiser's identity on their first request, so that an unknown person cannot publish an appeal for money.
47. As a Verifier, I want to verify a Bank Account before money can go to it, whether for Payout or for Refund, so that funds do not reach the wrong person.
48. As a Verifier, I want to grant a dated Kind Authorisation to a Partner Organisation, so that only licensed bodies run zakat and wakaf.
49. As a Verifier, I want warning 30 days before a Kind Authorisation expires, so that a lapse does not silently stop donations.
50. As a Verifier, I want to flag a Campaign as reported, so that an Admin can decide on Suspension.
51. As a Verifier, I want my decisions recorded with who, when and what, so that the trail survives me.

### Admin

52. As an Admin, I want to approve a Payout that someone else requested, so that no single person moves money alone.
53. As an Admin, I want to record the provider's real balance when I approve, so that an approval is checked against money that actually exists.
54. As an Admin, I want to mark a Payout Completed with proof of transfer, and to be a different person from whoever approved it, so that every rupiah out passes two pairs of hands.
55. As an Admin, I want to suspend a Campaign and have Donations stop, balances freeze and Payouts refuse, so that a problem campaign cannot take or move more money.
56. As an Admin, I want to create a Refund and have the money frozen by journal immediately, so that it cannot be paid out while the Refund is pending.
57. As an Admin, I want a second Admin to approve a Refund and a third action to complete it, so that Refund carries the same two-person protection as Payout.
58. As an Admin, I want a partial Refund to split fees proportionally without ever exceeding the refunded amount, so that the books balance and the Donor is never short.
59. As an Admin, I want a Refund that exceeds what the Campaign still holds to be booked to the platform's refund cost, so that a Campaign Balance never goes negative and the loss stays visible.
60. As an Admin, I want zakat and wakaf funds moved to another Campaign of the same Kind rather than refunded when a Campaign is suspended, and cross-Kind moves refused outright, so that religious funds follow their rules.
61. As an Admin, I want to record a Manual Contribution with proof and a second approver, so that money arriving outside the gateway is still in the books.
62. As an Admin, I want to reverse a Manual Contribution by opposite journal rather than delete it, so that the ledger stays append-only.
63. As an Admin, I want to set Platform Fee and Escrow Hold per Kind, per Category and per Campaign, so that disaster campaigns can be treated differently from the rest.
64. As an Admin, I want fee and hold changes to apply only to future Donations, so that no Donor's terms change after the fact.
65. As an Admin, I want a daily reconciliation report showing the provider balance against the ledger, so that a divergence is caught the day it appears.
66. As an Admin, I want to record withdrawing money from the provider to the collection account, so that the gap between the provider balance and the bank is visible rather than assumed.
67. As an Admin, I want a report of Campaigns holding a Campaign Balance more than 60 days after Expired or Completed, so that money does not quietly sit unclaimed.
68. As an Admin, I want an audit marker on Campaigns above Rp500 juta and a flag on single Donations above Rp50 juta, so that unusual money gets looked at.
69. As an Admin, I want additional Verifier review triggered above Rp100 juta per Campaign, so that scrutiny scales with the amount at stake.
70. As an Admin, I want to enable payment providers from the dashboard, so that adding VA and e-wallet does not require a deploy.
71. As an Admin, I want to anonymise a Donor on request while the amounts and journals stay, so that privacy does not cost accounting integrity.

### Visitor and Platform Operator

72. As a visitor, I want an Impact & Transparency page whose six lines sum exactly to the amount collected, so that the numbers are checkable rather than asserted.
73. As a visitor, I want refunded Donations still counted as collected and shown as a returned line, so that the history is honest about money that did arrive.
74. As a visitor, I want Demo Campaigns excluded from the public totals, so that fictional data never inflates real numbers.
75. As a visitor, I want to filter impact by location, so that I can see what happened near me.
76. As a Platform Operator, I want Platform Fee posted to the ledger on every Donation, so that the business has recorded revenue.
77. As a Platform Operator, I want every ledger entry separated by Kind and by provider, so that reporting and reconciliation work per licence and per provider.
78. As a Platform Operator, I want a Campaign to refuse to open unless its Collecting Entity holds a valid Fundraising Permit for that Kind, so that a lapsed licence stops collection automatically instead of relying on someone remembering.

## Implementation Decisions

### Domain and schema

- **Campaign lifecycle becomes an enum**, replacing the free-text `status` string: `DRAFT`, `SUBMITTED`, `REJECTED`, `ACTIVE`, `SUSPENDED`, `CANCELLED`, `COMPLETED`, `EXPIRED`. A data migration maps the existing `"active" | "completed" | "expired"` values and the interim `"pending"` written by the current stopgap. Only `ACTIVE` accepts a Donation.
- **`Kind` enum** (`donation`, `zakat`, `wakaf`) on Campaign. Kind determines the default Platform Fee, the required document checklist, whether a deadline is mandatory (it is, except `wakaf`) and the Refund limits.
- **`PartnerOrganisation`** and **`KindAuthorisation`** models. A Kind Authorisation is a dated grant from a Verifier to a Partner Organisation for one Kind. Expiry stops that Kind accepting Donations without hiding the Campaign or blocking Payout.
- **Collecting Entity** is a required reference on Campaign, always a Partner Organisation, never the Platform Operator (ADR 0010). An individual Fundraiser's Campaign must name a sponsoring Partner Organisation. **`FundraisingPermit`** is a dated permit held by a Collecting Entity; a Campaign of a given Kind cannot leave `DRAFT` unless a valid permit covers it.
- **`VerificationRequest`** model: one row per submission, holding the checklist result, the outcome, the rejection reason and the actor. Resubmission creates a new row; history is never overwritten. Covers the first-submission identity check and the re-verification triggered by changes to target, deadline or Bank Account on an `ACTIVE` Campaign, during which the Campaign keeps running on its previous values.
- **`UsageReport`** model attached to a Payout: narrative, line items summing exactly to the Payout amount, at least one photo, beneficiary count, and an Admin "questioned" flag with a publicly visible reason that blocks the next Payout.
- **`ManualContribution`** model: Admin-recorded, proof required, two-person rule, credited directly to Campaign Balance or Program Balance with no Escrow Hold and neither fee, reversible only by opposite journal.
- **Roles split** (ADR 0005): `Verifier` and `Admin` become independent assignments rather than ranks in the existing `Role` enum. One person may hold both. The audit trail records the capacity in which someone acted.
- **Field-level encryption** (ADR 0012): email stored as a deterministic keyed HMAC-SHA256 in a searchable column alongside a randomized ciphertext; phone and bank account number randomized AEAD; name plaintext. Key id column on each encrypted field to allow rotation.
- **Removals**: the wallet (`User.donationBalance`, `TopUp`, the balance endpoints) is deleted, honouring any outstanding balances first as the wallet module's own note requires. `AutoDonation` is parked, not deleted.
- **`pg_trgm`** is enabled by migration for the duplicate-Campaign hints; the similarity threshold (default 0.6) is Admin-configurable.

### Money

- **Platform Fee** is computed at Payment creation and posted to the existing `PLATFORM_FEE` ledger account, which is currently declared and never written. Resolution order: per-Campaign override, then per-Category, then per-Kind default. Waived below an Admin-set threshold. Rounded **down**, so the remainder falls to the Campaign, never the platform.
- **Every Payment freezes** the Platform Fee, the Provider Fee basis and the Escrow Hold duration that applied when it was created. Configuration changes apply only to later Donations.
- **Settlement timing**: a `settledAt` column is added and the Sumopod adapter reads `paid_at`/`settled_at` from the payload. Escrow Hold is anchored to the provider's settlement rather than to server time at webhook receipt, which is what the code does today and what `docs/integrasi-sumopod.md` already requires.
- **Escrow release runs on a schedule** through the new `runScheduledJobs` entry point, not only when a Payout is requested. The existing lazy sweep at the top of the Payout request handler is kept as a second path.
- **Payout completion**: a second Admin marks the Payout `COMPLETED` with proof of transfer, and must differ from the approving Admin. Ledger legs are DEBIT `PAYOUT_CLEARING` / CREDIT `GATEWAY_CLEARING` — the withdrawal happens from the provider dashboard straight to the Fundraiser (ADR 0006, FFI-07), so the money leaves the Provider Balance. **No new `LedgerAccount` value is required for this**, and it closes the existing gap where `GATEWAY_CLEARING` is debited on every settlement and never credited.
- **New ledger account `COLLECTION_ACCOUNT`** for the rekening penghimpunan, which is a different thing from the Merchant Account (ADR 0011) and may belong to a different legal entity. Recording a withdrawal from the provider to the collection account posts DEBIT `COLLECTION_ACCOUNT` / CREDIT `GATEWAY_CLEARING`, which is what makes the difference between the provider balance and the bank visible.
- **New ledger account `REFUND_COST`** for the Provider Fee the platform absorbs on a Refund (ADR 0007), plus the shortfall when Campaign funds no longer cover a Refund.
- **Refund is raised from Net to Gross** (ADR 0007). The cap in the ledger's refund leg builder currently rejects anything above the Net credited; this is the stale side of the contradiction and the ADR is the correct one. On approval of a Refund covered by Frozen Balance the ledger posts four legs: DEBIT `FROZEN`/source at Net, DEBIT `PLATFORM_FEE` at the fee originally taken, DEBIT `REFUND_COST` at the Provider Fee, CREDIT `REFUND_CLEARING` at Gross. On completion, DEBIT `REFUND_CLEARING` / CREDIT `GATEWAY_CLEARING`.
- **Refund lifecycle**: `Requested` → `AwaitingDonorDetails` → `Approved` → `Processing` → `Completed`, with `Rejected` from the first two and `Failed` from `Processing` returning to `AwaitingDonorDetails`. Freezing at `Requested` is a journal, not a flag, because Campaign Balance is always derived from the ledger.
- **Partial Refund**: fees returned proportionally to the refunded share of Gross, rounded up but never summing beyond the refunded amount, with the Frozen Balance leg taking the remainder and never going negative, so the three debits always total exactly the amount returned.
- **Per-Kind Refund limits**: `zakat` and `wakaf` are not refundable by management decision, only on technical failure (wrong payment, double payment, money arriving after closure). A suspended `zakat` or `wakaf` Campaign **transfers** its funds to another Campaign of the same Kind — and for `wakaf` the same category — with cross-Kind transfers **refused**, not warned. This requires the campaign-to-campaign transfer mechanism, which the PRD defers to roadmap under Dormant Balance; it is pulled forward into Fase 2 because the suspension rule cannot be honoured without it, and Dormant Balance reuses it later.
- **Ledger entries carry Kind, provider and collecting entity**, so reconciliation runs per provider and reporting runs per licence.
- **Concurrency**: every balance-touching operation (Payout, Refund, Manual Contribution, escrow release) locks the Campaign row and recomputes from the ledger inside that lock; every status transition uses a predicated update so two Admins clicking at once produce one change.

### Notification and scheduling

- **`Mailer` interface** mirroring `PaymentProvider`: a named interface with `send`, a registry, a mock implementation used by default, a real provider behind configuration, and a loud failure when unconfigured rather than a silent no-op. Transactional email covers verification outcomes (Fase 0), then Receipt, Akad Wakaf, Campaign Update, Payout and Refund notices.
- **`runScheduledJobs(now)`** as the single scheduled entry point: matured escrow release, campaign deadline reminders, Kind Authorisation expiry warnings at 30 days, Refund link expiry, and the 60-day unclaimed-balance report. Invoked by a cron route or container scheduler; the function itself is pure of scheduling concerns so it can be driven directly in tests.

### Presentation

- Impact & Transparency computes the six lines from the ledger and asserts they sum exactly to the collected figure; the page fails loudly rather than displaying numbers that do not reconcile.
- Payout, Refund, Bank Account and Usage Report gain the UI they currently entirely lack — the string `payout` appears in no `.tsx` file today.
- Receipt and Akad Wakaf are print pages reachable from email and dashboard, not generated PDF files.

## Testing Decisions

### Seams under test

The **exported route handler** is the primary seam. Behaviours are exercised by importing
the route module and invoking its exported `POST`/`PATCH`/`GET` with a mocked
`@/lib/prisma`, asserting on the HTTP response and on what was written. This is the
dominant existing seam and the prior art is extensive: `api/campaigns/route.test.ts`,
`api/webhooks/[provider]/route.test.ts`,
`api/campaigns/[slug]/payouts/[id]/approve/route.test.ts`, `api/donations/route.test.ts`,
`api/admin/reconcile/route.test.ts`. Testing here keeps authorisation, validation, status
mapping and persistence under the same test, and lets the service layer beneath be
refactored without rewriting tests.

Named route seams for this work:

- `POST /api/campaigns`, `PATCH /api/campaigns/[slug]` — lifecycle, Kind, Collecting Entity and permit refusal.
- `POST /api/campaigns/[slug]/verification-requests`, `PATCH /api/moderasi/verification-requests/[id]` — submission, withdrawal, checklist, rejection reason, resubmission history.
- `POST /api/donations`, `POST /api/webhooks/[provider]` — fee freezing, Settlement, Platform Fee posting, escrow anchoring to provider settlement.
- `POST /api/campaigns/[slug]/payouts`, `.../payouts/[id]/approve`, `.../payouts/[id]/complete` — the three-step two-person rule and the completion legs.
- `POST /api/campaigns/[slug]/payouts/[id]/usage-report` — line items summing to the Payout, gating of the next Payout.
- `POST /api/admin/refunds`, `.../refunds/[id]/approve`, `.../refunds/[id]/complete`, `POST /api/refunds/[token]/bank-account` — the Refund lifecycle including the signed donor link.
- `POST /api/admin/manual-contributions` and its reversal.
- `PATCH /api/admin/settings/fees` — per-Kind, per-Category, per-Campaign resolution and future-only application.
- `GET /api/admin/reconcile` — provider balance against ledger, per provider.

Two **service seams** are used only where a behaviour has no HTTP surface:

- `postTransaction` in the money layer, for property tests asserting that no sequence of settle, release, payout, refund and manual contribution can ever leave a transaction unbalanced. Prior art: `lib/money/ledger.test.ts`, which already does exactly this.
- `runScheduledJobs(now)`, driven directly with a fixed `now` rather than through timers.

Two **new seams**, both mirroring the proven `PaymentProvider` pattern:

- `Mailer` with a mock implementation. Email assertions are made against what the mock was asked to send, never against a network call.
- `runScheduledJobs` as above.

### What makes a good test here

Tests assert externally observable behaviour: the HTTP status, the response body, the rows
written, the ledger legs posted, the email the `Mailer` was handed. They do not assert that
a particular internal function was called or that a module has a particular shape. Money
tests assert the invariant rather than the implementation — debits equal credits, a balance
never goes negative, the same balance cannot be spent twice — and the repo's existing
property tests using `fast-check` are the model to follow.

Every behaviour that the two-person rule protects gets a test proving the *second* person
must differ from the first, and every ledger-posting path gets a test proving the legs
balance and total exactly the expected amount.

### Regression tests that must exist

- A Campaign created through the API is never publicly visible without a Verifier's decision.
- Approving a Payout never contacts a payment provider, so a provider without a disbursement API cannot strand it.
- A Refund returns Gross, not Net.
- Changing fee or Escrow Hold configuration does not alter any existing Payment.
- A Campaign whose Collecting Entity's permit has lapsed refuses new Donations.

## Out of Scope

Everything the PRD assigns to Fase 3 or excludes outright:

- **STALE as of 22 September 2026: the PRD revision that date moved CSR portfolio, Program, Sector, and Partnership Inquiry from Fase 3 into Fase 1 (FFI-09, FFI-10), and added Hibah as a fourth Campaign Kind (FFI-08b, ADR 0013). This spec was not rewritten to match — a fresh `/specflow:to-spec` pass is needed before either is ticketed.** The line below describes this spec's original, now-superseded scope:
- ~~CSR portfolio, Program, Sector, Partnership Inquiry, Program Balance beyond the ledger account itself.~~
- Volunteer Event, Registration, volunteer certificates. Still out of scope — Volunteer stayed Fase 3, only its menu placement changed.
- English version and the i18n switch. Translation keys are introduced as Fase 1 pages are written, but no second language ships.
- WhatsApp notifications, short share links, automatic settlement import.
- Donor-initiated Refund. Refunds are always created by an Admin.
- Team members for organisation Fundraisers.
- Dormant Balance *handling*. Only the 60-day report is in scope; the transfer mechanism is built in Fase 2 for the zakat/wakaf suspension case and reused later.
- Native mobile app, scheduled card auto-donation, user wallet, accounting-system integration, merchandise or charity auction, blockchain waqf certificates, skills-based volunteer matching.

## Further Notes

**Two facts are still outstanding and affect sequencing rather than content.** First, team
headcount and whether Makam.co.id runs concurrently, which decides whether the three arcs
run sequentially or in parallel. Second, whether the Sumopod merchant account is contracted
and live and in whose legal name — ADR 0011 forbids sharing it with Makam.co.id, so if it
is already shared that must be unwound before the first real payment.

**Legal dependency.** ADR 0010 makes the Collecting Entity a first-class attribute
precisely because the permit question is unresolved. If counsel confirms that collection
must happen in a Partner Organisation's name, this design already carries it. If counsel
says something else entirely, the Collecting Entity field is where that answer lands, and
nothing else needs to move.

**Already corrected on the branch, not part of this spec.** Campaigns creating themselves
as `ACTIVE` (now `pending`, awaiting the lifecycle enum this spec introduces); payout
approval calling a provider that cannot disburse; fabricated press releases and job
listings on the public site.

**Known stale content flagged but untouched:** `terms` and `privacy` both claim "Terakhir
diperbarui: 1 Januari 2024". Only the operator knows when those were last reviewed.
