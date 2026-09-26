## Problem Statement

`fundforindonesia.org`'s frontend has never had a deliberate visual design pass —
its current palette (`#0073E6` blue primary, `#FF6B35` orange accent, plain Inter
throughout) is a generic scaffold default, not a chosen identity. Meanwhile, a
sibling codebase for this same platform (`galangdana`/`ffi`, a SvelteKit monorepo,
checked out at `/home/ubuntu/ffi`) already has a fully reasoned, partially-shipped
visual redesign: "The Ledger Line" (`docs/design/2026-09-06-visual-redesign-plan.md`
in that repo). Its core insight is specific to this platform, not generic: the
product's own copy already makes a claim no competitor's does — *dana tidak kami
cairkan sebelum bukti ada dan dua orang menyetujuinya* (money isn't released until
proof exists and two different people approve it) — and the current visual system,
in both codebases, gives that claim no visual language of its own. Every card,
every number, every status looks the same regardless of whether it's a marketing
figure or an audited fact.

This spec ports that design *decision* — not the code, since the two codebases
don't share a framework (SvelteKit vs. Next.js) — into `fundforindonesia.org`.

## Solution

Apply the Ledger Line design system (color tokens, a two-register typography split,
and the Ledger Line motif itself) to every page `fundforindonesia.org` already
ships. Two modules PRD names as part of this platform — CSR/Program collaboration
and Volunteer Trip — have **zero frontend surfaces today** (API-only, confirmed by
directory inspection: no `program`/`csr`/`kemitraan` route, no `volunteer-trip`
route anywhere under `src/app/`). Building those pages is real, separate,
multi-ticket work — this spec does not attempt it; see Out of Scope. What this spec
covers is every page that *does* exist: donasi (the Campaign/Donation flow, which
already carries the `donasi`/`wakaf`/`hibah` distinction as a Campaign `Kind`
field, not separate routes) and galang dana (campaign creation), plus every static
and admin/moderasi page.

## User Stories

1. As a Donor, I want the campaign detail page and donation flow to visually
   signal that a completed donation becomes a record the platform can prove, not
   just a number that went up, so the platform's actual differentiator (dual
   approval, proof-gated disbursement) is something I can *see*, not just read
   about in a paragraph of copy.
2. As a Donor reading a campaign card, I want its progress indicator to carry the
   same visual language as the platform's proof-backed claims, so the card itself
   starts building the trust the detail page and receipt later confirm.
3. As a Fundraiser going through campaign creation, I want to sense from the first
   step that what I'm building will later be held to account (via a Record-register
   progress indicator), consistent with how the rest of the platform treats records.
4. As any visitor, I want the platform's brand identity (warm green/terracotta, not
   generic blue/orange) to be consistent across every page I visit, including the
   static pages (About, FAQ, Contact, etc.) and the donation/campaign flow.
5. As an Admin or Verifier, I want the admin/moderasi shell to have real
   navigation to the routes that already have an index page, instead of every
   route being reachable only by typing its URL.
6. As a developer maintaining this codebase, I want the Ledger Line motif (the
   signature "this claim is backed by a record" visual) used in a small, fixed set
   of places with a clear rule for where it's allowed, not scattered wherever it
   looks nice — so the motif keeps meaning something.
7. As a developer, I want the new gold/ledger color token and the Record
   typography register (serif + mono) to never appear on interactive controls
   (buttons, nav, form inputs) — those stay in the everyday register — so the
   distinction between "this is a claim of record" and "this is the platform being
   used" stays legible.
8. As a developer picking this ticket up later, I want a clear, explicit list of
   what's deliberately not covered (CSR/Program pages, Volunteer Trip pages, the
   receipt/kuitansi page, the disbursement/pencairan-dana page — none of which
   exist as frontend routes here yet), so nobody assumes this ticket silently
   covers surfaces it structurally cannot, since those pages don't exist to
   restyle.

## Implementation Decisions

**Source of truth split (this is a re-implementation, not a port):**
`ffi`'s SvelteKit codebase and this repo's Next.js/React/Tailwind codebase share
no component code, no build tooling, and no styling system format. Treat
`ffi`'s design *plan* document (its full text is reproduced in Further Notes
below) as the authoritative source for token values, typography rules, and the
Ledger Line motif's usage rules — copy those verbatim. Treat `ffi`'s *shipped*
Svelte code only as a reference for concrete implementation technique where
useful (e.g., its dashed Ledger Line rendering trick: a `repeating-linear-gradient`
CSS background, framework-agnostic, portable as-is into a Tailwind arbitrary
value or a small CSS utility class) — not as a source of exact values, since the
plan document itself admits its own earlier draft overstated what was actually
wired up in that codebase (Newsreader "wired into the kuitansi page" turned out
to be false; only `font-mono` existed there in practice). Where the plan and the
shipped code disagree, the plan wins for what SHOULD exist; neither is assumed
correct about what already does.

**Color tokens** — add to `tailwind.config.ts`'s `colors` block, alongside the
existing `primary`/`accent`/etc. (do not remove the existing keys outright in
this step; see the migration note below):

| New Tailwind key | Value | Role |
|---|---|---|
| `brand.DEFAULT` (replaces `primary.DEFAULT`) | `#2F7A5F` | Primary actions, brand |
| `brand.accent` (replaces `accent`) | `#D97748` | CTAs that must stand out |
| `ink` | `#1C1A15` | Headline-weight text only |
| `paper` | `#FDFBF8` | The ledger surface — receipts, disbursement records, anything being *attested*, distinct from an ordinary card background |
| `ledger` | `#B8862E` | **Used nowhere except the Ledger Line motif itself** (see below). Not a general accent, not a button color, not a hover state. |

Migration note: `fundforindonesia.org`'s current `primary`/`accent`/`bg`/`text`
Tailwind keys are referenced across the existing codebase (every button, card,
link). This spec's job is to change what those keys resolve to (and add the three
new ones), not to rename every call site in one pass — a full audit of every
`text-primary`/`bg-primary`/etc. usage to confirm nothing was relying on the OLD
blue-branded meaning in a way the new green would break (e.g., a status color
accidentally reusing `primary` for something semantic) is real, necessary work
for whoever implements this, not a detail to skip.

**Typography** — two registers, matching the plan exactly:
- Everyday register: keep the existing sans stack for navigation, buttons, forms,
  campaign titles, body copy, admin table text — this is "the platform being
  used." (`ffi`'s plan specifies Plus Jakarta Sans for this register; this repo's
  current sans is self-hosted Inter, per an unrelated fix earlier this session
  that vendored it locally to remove a build-time dependency on
  fonts.googleapis.com — whoever implements this decides whether to also
  self-host Plus Jakarta Sans to match `ffi` exactly, or keep Inter as this
  repo's own everyday register and only add the Record register fonts; either is
  defensible, but the choice should be made deliberately and recorded, not
  defaulted silently.)
- Record register: Newsreader (serif, for prose) + JetBrains Mono (for
  numbers/IDs) — new to this codebase. Self-host both, the same way Inter
  already is (`src/fonts/`, `next/font/local`), for the same reason: this
  repo's Docker build has no reliable route to fonts.googleapis.com, already
  hit and fixed once this session.
- Where the Record register applies, on THIS repo's actual existing pages: a
  donation/campaign amount or ID shown as a stated fact (mono), and any prose
  that is genuinely a claim of record. Since the receipt and disbursement-ledger
  pages don't exist here yet (Out of Scope), the Record register's real
  footprint in this ticket is narrower than in `ffi`'s plan — apply it where a
  genuine existing-page equivalent exists (e.g., a confirmed donation amount on
  the campaign detail page), and do not invent a use for it just to justify
  loading the fonts.

**Layout, scoped to pages that actually exist in this repo:**
- `src/components/campaign/CampaignCard.tsx` — progress bar gains the Ledger
  Line motif (see below) instead of a flat two-tone bar.
- `src/app/campaign/[slug]/page.tsx` (campaign detail) — fix the same
  below-the-fold hero problem `ffi`'s UAT found: cap the hero image to a fixed
  aspect ratio, info panel adjacent on wide viewports rather than stacked
  beneath a tall image.
- `src/app/campaign/create/page.tsx` — this repo's campaign creation is
  currently a single page/form, not `ffi`'s ~9-10 step wizard structure. The
  "numbered progress rail in the Record register" idea from the plan needs
  adapting to whatever this page's actual step/section structure turns out to
  be (read the real file before assuming a shape) — do not force a 9-10-step
  rail onto a differently-structured flow.
- Static pages (`src/app/(static)/*`) and the admin/moderasi shell — apply the
  new color/type tokens for brand consistency. `ffi`'s plan's "AdminShell nav
  entries for the four routes with a real index page" idea applies here too;
  read this repo's actual admin/moderasi route structure first (it already has
  `/admin/campaigns`, `/admin/users`, `/moderasi/campaigns`, `/moderasi/reports`
  — confirm which of these have real index pages worth a nav entry, following
  the plan's own reasoning for why to include or exclude a route, not just its
  specific four-route count, which was for `ffi`'s own route set).

**Signature: the Ledger Line motif** — same three-place rule as the plan, adapted
to what exists here:
1. Under a campaign card's progress bar, as milestone ticks (fixed at 25/50/75%
   for every campaign, not derived from real disbursement data — same
   "a promise about the platform's process, not a report on this campaign"
   reasoning the plan gives, and for the same reason: no disbursement-ledger
   page exists here yet to hold the real, record-backed account one click away).
2. The other two placements the plan names (disbursement timeline on
   `pencairan-dana`, the closing rule on the kuitansi) have no page to attach to
   in this repo yet — out of scope until those pages exist (see Out of Scope).
   Do not invent a substitute placement for either; a motif meaning "this claim
   is backed by a record" attached to something that isn't one defeats the
   entire discipline the plan itself insists on.

Implementation technique for the line itself: a CSS `repeating-linear-gradient`
background (confirmed working in `ffi`'s shipped code, framework-agnostic, no
SVG or extra dependency needed) — e.g.
`background-image: repeating-linear-gradient(to bottom, theme(colors.ledger) 0 4px, transparent 4px 8px)`.

## Testing Decisions

**Seam under test:** this is a visual/CSS/markup change with no new business
logic and no new API surface — existing route-handler and component tests
(`CampaignCard.test.tsx`, etc.) are the seam, and they should keep passing
unchanged unless a test was asserting on specific class names or colors that
this change deliberately replaces (e.g., a test asserting `bg-primary` resolves
to the old blue hex — update the *expected value*, not the assertion's intent).
Do not add snapshot tests for visual appearance; this codebase has no visual
regression tooling and this ticket doesn't introduce one. Where a component's
existing test suite checks *behavior* (does the progress bar show the right
percentage, does the hero render the right image), keep those tests exactly as
rigorous — a visual refresh must not be an excuse to weaken behavioral coverage.

Manual verification (browser, real pages, both this ticket's own explicit
requirement per this project's own UI-change convention and because no
automated visual-regression tooling exists to catch a botched color/type swap):
campaign card, campaign detail page (both above and below the hero fix), campaign
creation, at least one static page, and the admin/moderasi shell's new
navigation — confirm the golden path and that nothing regressed.

## Out of Scope

- **CSR/Program pages** (catalog, Partnership Inquiry form) — no frontend route
  exists (`program`, `csr`, `kemitraan`, nothing under `src/app/`), and per
  earlier investigation this session, no backend for it exists either. Building
  it is real, separate, multi-ticket work with its own domain modeling to do
  first (Program vs. Campaign per ADR 0002).
- **Volunteer Trip pages** (catalog, registration, Batch management) — the
  backend is fully built (six tickets' worth, this session), but there is
  **zero** frontend for any of it. This is real, separate work; applying Ledger
  Line to pages that don't exist isn't possible, and building those pages
  should be its own ticket (or set of tickets, given the size) with its own
  spec, not folded into a visual-refresh ticket.
- **Receipt/kuitansi page** and **disbursement/pencairan-dana page** — neither
  exists as a frontend route in this repo (confirmed: only the API routes
  under `src/app/api/campaigns/[slug]/payouts` and
  `src/app/api/volunteer-trips/[slug]/payouts` exist; no page). Two of the
  Ledger Line motif's three canonical placements have nowhere to attach until
  these are built — a real, tracked gap, not a silent one.
- Any change to routes, data model, or business logic — this is a pure visual
  refresh over the existing structure, matching `ffi`'s own plan's stated depth.
- Zakat/wakaf category-specific legal or branding questions — explicitly out of
  scope in `ffi`'s own plan too, and nothing in this session's own work changes
  that.
- Dwibahasa (English-language toggle, FFI-15) — unrelated to this visual
  refresh, a separate PRD item entirely.
- A visual-regression testing tool — not introduced by this ticket; manual
  verification is the stated seam, above.

## Further Notes

**This spec is very likely bigger than one plan.** It touches global tokens
(color, type), a shared component (`CampaignCard`), the campaign detail page,
campaign creation, every static page, and the admin/moderasi shell — five-plus
genuinely separable surfaces, each with its own real adaptation decisions (the
wizard-shape mismatch, the AdminShell route audit, the font-loading choice).
Whoever runs `/specflow:spec-to-plan` next should seriously weigh running
`/specflow:to-tickets` first rather than forcing this into one plan — this is
exactly the "wide but not a mechanical rename" shape that guidance warns about
forcing into a single writing-plans pass.

**Cross-repo relationship, for whoever picks this up without today's full
context:** `fundforindonesia.org` (this repo) and `galangdana`/`ffi` (SvelteKit,
`/home/ubuntu/ffi` on this host, remote `andrianm28/galangdana`) are two
separate, currently-diverged codebases for the same underlying product. Which
one is the long-term canonical implementation is not this spec's call to make —
this spec only borrows `ffi`'s already-reasoned design *decision*, because no
equivalent design work has happened in this repo yet and re-deriving it from
scratch would be needless duplication of real design reasoning that already
exists and already survived a whole-branch review (the plan document itself
records a self-correction from that review, re: the "six existing routes"
AdminShell miscount).

**Full text of `ffi`'s original plan** (`docs/design/2026-09-06-visual-redesign-plan.md`
in that repo), reproduced here so this spec is self-contained and does not
require access to the other repo to implement:

---

[The complete text of the plan — Color, Type, Layout, Signature: the Ledger
Line, Self-review against genericness, and What this plan does not decide
sections — is available at `/home/ubuntu/ffi/docs/design/2026-09-06-visual-redesign-plan.md`
on this host. It is long (71 lines) and already fully paraphrased into this
spec's Implementation Decisions above with this repo's own adaptations noted
inline; the plan-writer for the eventual implementation plan should read the
original directly rather than rely on a second paraphrase of a paraphrase.]
