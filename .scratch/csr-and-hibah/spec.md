# Spec: CSR portfolio and Hibah Kind

Source: PRD `docs/PRD-fund-for-indonesia.md` (revisi 22 September 2026, §3, FFI-08b, FFI-09, FFI-10, §11), `CONTEXT.md`, ADR 0002, ADR 0013.

This spec covers the two pieces of scope a 22 September grilling session pulled forward: Kolaborasi CSR (moved from Fase 3 into Fase 1) and Hibah (a new fourth Campaign Kind, replacing Volunteer's primary menu slot). It supersedes the "Out of Scope" line in `.scratch/prd-compliance-fase-0-2/spec.md` that previously excluded CSR.

## Problem Statement

A company or CSR team looking for a partner cannot find a ready-to-run program on the platform today — there is no portfolio to browse, no way to see a program's budget, timeline, or KPIs, and no way to start a conversation about collaborating. They currently have to be pitched from scratch every time, which is the exact friction the platform exists to remove.

Separately, a donor or institution wanting to give a directed grant — money for a specific institution or purpose that is neither an obligatory zakat payment nor a perpetual waqf endowment — has no Campaign Kind that fits. Donasi doesn't carry the institutional oversight a grant usually needs; Zakat and Wakaf carry rules (irreversibility, specific licensing) that don't necessarily apply to a directed gift.

## Solution

**CSR** becomes a real module: a public portfolio of Programs grouped by a fixed set of four Sectors, each Program page detailed enough for a CSR team to evaluate it, and a Partnership Inquiry form that starts the conversation. Program never takes money through the payment gateway — that boundary is deliberate and already decided (ADR 0002) — but money that does reach the platform's own account for a Program is recorded the same way any other off-gateway money is: as a Manual Contribution, credited to a new Program Balance ledger account that can never be paid out, because a Program is not a Campaign.

**Hibah** becomes the platform's fourth Campaign Kind, riding on every piece of money-layer machinery Zakat and Wakaf already use — the same Campaign, Payment, ledger, escrow, and payout path (ADR 0002), the same Kind Authorisation gate, the same per-Kind refund and fee rules. Its specific rules are copied from Wakaf as an explicit placeholder (ADR 0013) pending a review neither this spec nor the codebase can perform, and that placeholder status is preserved here rather than quietly resolved.

## User Stories

### CSR

1. As a company or CSR team, I want to browse Programs grouped by Sector, so that I can find a partnership that matches our focus area.
2. As a company or CSR team, I want each Program's page to show the problem, target beneficiaries, location, activities, budget, timeline, KPIs, documentation, and impact report, so that I can evaluate it without a proposal being written from scratch.
3. As a company or CSR team, I want a "Discuss with Our Team" action on a Program, so that I can start a conversation without hunting for a contact.
4. As a company or CSR team, I want my Partnership Inquiry to reach the partnership team with our company details and needs, so that follow-up happens without me having to chase it.
5. As a member of the partnership team, I want to see the status of a Partnership Inquiry, so that I know whether it's been followed up.
6. As an Admin, I want to create and edit a Program from a panel — problem, target beneficiaries, location, activities, budget, timeline, KPIs, documentation, impact report — so that the portfolio can be kept current without a deploy.
7. As an Admin, I want the four Sectors (Health, Education, Environment, Disability Inclusion) fixed in code rather than editable from a panel, so that the sector taxonomy the deck defines doesn't drift.
8. As an Admin, I want to record CSR money that passed through the platform's own account as a Manual Contribution pointing at a Program, so that it enters the books the same way any other off-gateway money does — with proof, the two-person rule, and no Escrow Hold or fees.
9. As an Admin, I want CSR money that never touched the platform's account shown as a plain reported number, clearly marked as outside the platform's books, so that it's never confused with money the ledger can account for.
10. As a Fundraiser or Admin, I want a Program Balance to be structurally impossible to pay out through the Campaign Payout flow, so that money credited to a Program can never leave through the wrong door.
11. As a visitor, I want the Impact & Transparency page to show CSR money as its own line, separated into "in the books" and "outside the books," so that the platform's own transparency promise (FFI-14) extends to CSR the same way it does to Campaigns.
12. As a Partner Organisation running a Program, I want the Program itself to never accept online Donations, so that a Program is never mistaken for a fundraising Campaign.

### Hibah

13. As a Donor Hibah, I want to give a directed gift to a Campaign of Kind `hibah`, so that my gift reaches the institution or purpose I intend.
14. As a Donor Hibah, I want the same nominal choices, Receipt, and anonymity options any other Donor gets, so that giving a Hibah is no harder than giving a Donasi.
15. As a Fundraiser, I want to create a Campaign of Kind `hibah` only if my organisation holds a Kind Authorisation for `hibah`, so that the same institutional gate Zakat and Wakaf already have applies here too.
16. As a Verifier, I want to grant and see the expiry of a Kind Authorisation for `hibah`, using the exact same mechanism I already use for `zakat` and `wakaf`.
17. As an Admin, I want Hibah's default Platform Fee to be zero, matching Zakat and Wakaf, so that a directed gift isn't reduced by a platform cut unless I deliberately change it.
18. As an Admin, I want a Refund on a `hibah` Payment refused except for wrong payment, double payment, or funds arriving after Campaign closure — the same carve-out Zakat and Wakaf already have — so that an ordinary "I changed my mind" request doesn't get through by mistake.
19. As an Admin, I want a suspended `hibah` Campaign's funds transferred to another Campaign of the same Kind rather than refunded, matching the existing zakat/wakaf suspension rule, with cross-Kind transfer refused outright.
20. As a Verifier, I want the document checklist for a `hibah` submission to mirror `wakaf`'s checklist until it's reviewed and given its own, so that verification doesn't silently skip a step no one has decided to skip.
21. As anyone reading the domain documentation, I want Hibah's rules marked as a stated placeholder rather than a settled decision, so that a future correction isn't mistaken for a regression.

## Implementation Decisions

### CSR

- New models: `Program` (problem, target beneficiaries, location, activities, budget, timeline, KPIs, documentation, impact report, a `sector` field) and `PartnershipInquiry` (company name, contact details, needs description, a status field for follow-up tracking, a reference to the Program it's about).
- `Sector` is a fixed four-value enum (`HEALTH`, `EDUCATION`, `ENVIRONMENT`, `DISABILITY_INCLUSION`) defined in code, never Admin-editable — deliberately different from `Category`, which stays Admin-configurable and applies to Campaigns, not Programs. The two are not the same concept and are not unified.
- `Program` never has a `Kind`, never accepts a `Donation`, and is never a `Campaign`. No payment provider, escrow, or Payout code path can reference a Program.
- New `LedgerAccount` value: `PROGRAM_BALANCE`. CSR money that crosses the platform's account is recorded as a Manual Contribution whose target is a Program rather than a Campaign, crediting `PROGRAM_BALANCE` directly — no Escrow Hold, no Platform Fee, no Provider Fee, exactly matching the existing no-fee rule already decided for Campaign-targeted Manual Contributions.
- This requires generalising Manual Contribution's target from "always a Campaign" to "a Campaign or a Program" — a real interface change to whatever Manual Contribution implementation lands first (see Further Notes; Manual Contribution itself is not yet built as of this spec).
- Program Balance can never be paid out: the Payout request path requires a Campaign id, and nothing in this spec adds a Program-Payout path. This is an invariant to test, not merely a fact to state.
- CSR money that never crosses the platform's account produces **no ledger entry at all** — it is a plain reported figure, explicitly and visibly marked as outside the platform's books wherever it's shown (Program detail page, Impact & Transparency).
- Partnership Inquiry notification to the partnership team uses the `Mailer` seam the parent spec already defines (not yet built) — no second notification mechanism is introduced.

### Hibah

- `hibah` is defined as a fourth value of the `Kind` enum from the moment that enum is built (the enum does not exist yet in the schema as of this spec — see Further Notes) — `donation | zakat | wakaf | hibah`, not an addition made after the fact.
- Kind Authorisation, the per-Kind document checklist, the per-Kind refund limit, and the per-Kind Platform Fee default all gain a `hibah` case wherever they already have a `zakat`/`wakaf` case, copying Wakaf's treatment exactly (ADR 0013): Kind Authorisation required, Platform Fee default zero, Refund blocked except technical failure, checklist mirrors `wakaf`'s.
- This copy is implemented as data (a per-Kind rule table or equivalent), not as a one-off hardcoded exception, so that correcting Hibah's rules later — if a review finds they should differ from Wakaf's — touches one place, not every call site. Where the existing precedent for zakat/wakaf is itself a hardcoded per-Kind check, Hibah matches that same shape for consistency; do not invent a new pattern for Hibah alone.
- No Akad Wakaf-equivalent document is introduced for Hibah in this spec — FFI-08b specifies none, and inventing one would be new scope beyond what was decided.
- `hibah`'s suspension-transfer rule (funds move to another Campaign of the same Kind, cross-Kind transfer refused) reuses the exact mechanism the parent spec's ticket 33 already builds for zakat/wakaf — no new transfer logic.

## Testing Decisions

### Seams under test

Both pieces reuse the seams the parent spec (`prd-compliance-fase-0-2`) already established — no new seam is introduced.

- **The exported route handler** is the primary seam, exactly as the parent spec defines it: import the route module, invoke its exported `POST`/`PATCH`/`GET` with a mocked `@/lib/prisma`, assert on the HTTP response and what was persisted.
  - Named new route seams: `POST /api/programs`, `PATCH /api/programs/[id]` (Admin panel CRUD), `GET /api/programs`, `GET /api/programs/[slug]` (public portfolio and detail), `POST /api/partnership-inquiries`, `PATCH /api/admin/partnership-inquiries/[id]` (status follow-up).
  - Hibah introduces no new route seam. Its behaviour is exercised entirely through the same route seams the parent spec already names for Kind-driven logic: Campaign creation, Verification Request, donation, and refund.
- **`postTransaction`** (the money-layer service seam the parent spec already uses for ledger property tests) covers CSR's Program Balance postings — the same seam, pointed at a Program-targeted Manual Contribution instead of a Campaign-targeted one.

### What makes a good test here

Same standard as the parent spec: assert externally observable behaviour — the HTTP status, the response body, the rows written, the ledger legs posted — never that a particular internal function was called. Money-layer tests assert the invariant (a Program Balance posting can never be a Payout source; debits equal credits) rather than the implementation.

### Regression tests that must exist

- A Program Balance can never be the source of a Payout, however it's requested.
- CSR money that never crossed the platform's account produces zero ledger entries and is visibly marked as outside the books everywhere it's reported.
- A Campaign of Kind `hibah` refuses creation without a valid, unexpired Kind Authorisation for `hibah`.
- A Refund on a `hibah` Payment is refused for an ordinary request and permitted only for the technical-failure carve-out.
- A suspended `hibah` Campaign's transfer refuses a cross-Kind destination outright, matching the existing zakat/wakaf behaviour.

### Prior art

`lib/money/ledger.test.ts` for the `postTransaction` property tests; `api/campaigns/route.test.ts`, `api/moderasi/campaigns/[id]/route.test.ts` for the route-handler seam style this spec's new routes should match.

## Out of Scope

- CSR taking payment directly through the payment gateway. ADR 0002's boundary — Program never accepts an online Donation — is reaffirmed here, not reopened.
- A genuine fiqh review of Hibah's rules. This spec ships ADR 0013's placeholder as-is; correcting it is separate work with its own review, not something this spec resolves.
- Sector becoming Admin-configurable. Deliberately fixed in code per the PRD.
- Volunteer Event, Registration, volunteer certificates, and anything else still assigned to Fase 3. Unaffected by this spec.
- English/i18n for any CSR or Hibah page. Still Fase 3 per the parent spec.
- An Akad Wakaf-equivalent document for Hibah.
- Manual Contribution's own build if it is not already covered by the ticket that builds it. This spec assumes Manual Contribution exists or is generalised to a Program target as part of landing CSR's Program Balance crediting — see Further Notes.

## Further Notes

**Cross-spec dependency, not yet resolved.** Program Balance crediting depends on Manual Contribution, which is ticket 34 in the parent spec's breakdown and does not exist yet. When this spec is ticketed, either sequence CSR's Program-crediting ticket after ticket 34 lands, or fold "generalise Manual Contribution's target to Campaign-or-Program" into whichever ticket builds Manual Contribution first — building two separate, divergent Manual Contribution paths would be the wrong outcome.

**Hibah rides on infrastructure that doesn't exist yet either.** `Kind`, `KindAuthorisation`, the per-Kind refund limit, and the per-Kind fee default are tickets 09, 11, 31, and 17 in the parent spec, none built as of this spec. Hibah is not "add a case to existing code" — it's "build the Kind enum with four values from the start, and build every per-Kind rule point with a `hibah` case already in it." Ticket-writing should reflect that Hibah is threaded through those tickets' own acceptance criteria, not bolted on afterward as a separate ticket that edits already-merged code.

**The placeholder is meant to be found and questioned.** ADR 0013, the PRD's §12 risk entry, and CONTEXT.md's Hibah term all flag the Wakaf-copy as provisional. Nothing in this spec should read as though that question has been answered — a reviewer or implementer who notices the placeholder and asks about it is reading the documentation correctly, not catching an inconsistency.
