# 04: Public CSR portfolio and Program detail pages

**What to build:** A CSR team can browse Programs grouped by Sector and read
a Program's full detail without a proposal being written from scratch.

**Blocked by:** 01

**Status:** done (PR #77, 2d1a981)

- [x] `GET /api/programs` lists Programs grouped or filterable by the four
      fixed Sectors
- [x] `GET /api/programs/[slug]` returns one Program's problem, target
      beneficiaries, location, activities, budget, timeline, KPIs,
      documentation, and impact report
- [x] The portfolio page shows a Sector card for each of Health, Education,
      Environment, Disability Inclusion
- [x] The Program detail page shows every field above plus a "Discuss with
      Our Team" action that opens the Partnership Inquiry form (ticket 05)
- [x] Neither route nor page ever surfaces a Donation control, a payment
      method, or anything implying a Program takes money online

## Comments

- 2026-09-27 (csr-04, in PR #77): the two reads are `listProgramPortfolio` and
  `readProgram` in `src/lib/programs.ts`; the two pages call the same two
  functions the routes call, so page and API cannot disagree about what a
  Program is. The payload is named field by field (not a row handed back), and
  it carries no money field: no `collected`, `donation`, `payment`, `payout`
  or `balance`, so nothing here can contradict `impactBreakdown`
  (`src/lib/money/impact.ts`), which reads the ledger. `reportedAmount` is
  absent on purpose -- see below.

- 2026-09-27 (csr-04, in PR #77): the off-books reported figure is
  deliberately NOT on the Program page yet. CSR money that never crossed the
  platform's account is only meaningful beside the ledger-backed Program
  Balance, which arrives with ticket 07; ticket 08 (csr-08) puts the two side
  by side, the off-books one labelled as outside the books. Printing it alone
  today would be a number with nothing to be compared against. Two tests in
  `src/app/api/programs/[slug]/route.test.ts` and
  `src/app/program/[slug]/page.test.tsx` hold that line.

- 2026-09-27 (csr-04, in PR #77): the route segment moved from `[id]` to
  `[slug]`. The public read needs the segment to be the slug -- the one
  identifier a public link can carry -- and Next allows one dynamic segment
  per level, so the two could not both exist. `PATCH` resolves the slug to the
  id and then calls `updateProgram` unchanged, exactly as
  `PATCH /api/campaigns/[slug]` already resolves a Campaign's slug. Admin
  behaviour, refusals and status codes are unchanged. The spec's own seam list
  asked for `GET /api/programs/[slug]`, so this resolves the spec's
  contradiction in its favour rather than against it.

- 2026-09-27 (csr-04, in PR #77): the "Discuss with Our Team" action is a form
  on the Program page that posts to `POST /api/partnership-inquiries`, which is
  ticket 05's endpoint (PR #71, still open). Until #71 lands the endpoint does
  not exist and the form reports the refusal instead of pretending it was sent;
  the page's own tests do not depend on that endpoint existing.

- 2026-09-27 (csr-04, in PR #77): not in this ticket, flagged for the owner --
  nothing links to `/program` yet (no sitemap entry, no footer or homepage
  link). The ticket named the two routes and the two pages, so the work stopped
  there; a one-line Footer entry would make the portfolio findable whenever
  that is wanted.
