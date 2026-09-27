# Map:\Product can do its job — every role, and money that actually moves

## Destination

A real donation enters, and the money reaches a Fundraiser's verified bank
account — and every role can do their job through the product rather than
through a database client. Reached when: one donation goes through donate →
Settlement → Payout → a real bank account, with the evidence the PRD promises
is public, and no step of that needs `psql`.

Every session orients to this before choosing a ticket.

**The destination, counted:** [scorecard.md](scorecard.md) measures every job in
the job descriptions against what a person can actually reach. As of
2026-09-27: Donor 5 of 5, Tim CSR 2 of 4, Verifier 6 of 8, Fundraiser 2 of 5,
Volunteer 0 of 5, **Admin 2 of 13**.
A screen does not count unless something points a person at it — a button, a
nav link, or a redirect. Ten of Admin's thirteen jobs are enforced in code and
unreachable by a person, which is why the money cannot move through the
product. The Volunteer module is unreachable at **both** ends, so a Volunteer
Trip can be created and never approved.

## Notes

- **Skills every session consults**: `grilling` and `domain-modeling` (always
  both), `research` for research tickets. Read `CONTEXT.md` and `docs/adr/`
  before deciding anything about money — ADR 0002, 0006, 0007 and 0011 all
  bear on it.
- **Workflow**: `AGENTS.md` — the coordinator dispatches, builders work in
  worktrees, money and security code always gets an independent review.
- **Standing preference**: prefer deciding a question over guessing. Three of
  the four findings this map was chartered from turned out to be
  non-questions that were left open, and the cost was code shipped around
  them.
- **The tracker's `done` is not trustworthy on its own.** A ticket has been
  found marked `done` while its PR was unmerged. When a decision depends on
  "is this shipped", check the merge, not the status line.

### What this map was chartered from

Verified against the code, not the tracker. Each finding is developed in the
ticket it became.

Findings that shaped the tickets below, all verified against the code rather
than the tracker:

- **`BankAccount` cannot be created by anyone.** `bankAccount.create` does not
  exist anywhere in `src/`; the only writer is `prisma/seed.ts`. Payout demands
  `verifiedAt`, so a real Fundraiser has no way to set a destination.
- **No Admin panel for Payouts.** `approvePayout` and `completePayout` exist
  and enforce the two-person rule, but no screen in `src/app/admin` calls
  either. A Payout raised through the product stays PENDING.
- **Usage Report does not exist at all** — no model, no route. It gates "a
  Usage Report is required before the next Payout", the Campaign page's list
  of completed Payouts, and the beneficiary count on Impact.
- **There is no document upload.** §7.1 has eleven checklist rows and not one
  document behind them; a Verifier ticks a label. `/api/upload` accepts images
  only, writes to `public/uploads`, and has no access control.
- **Eleven Admin routes have no screen at all**: `reconcile`, `scrutiny`,
  `platform-fee`, `manual-contributions`, `abuse-thresholds`,
  `duplicate-similarity`, and four more. The rules are enforced in code and
  unreachable by a person.
- **Four components are complete, tested, and rendered nowhere**:
  `CampaignDetail.tsx` (with working Updates and Payout tabs), `ShareModal`,
  `CampaignPrayers`, `CampaignCTA`.

## Decisions so far

<!-- the index: one line per closed ticket, then zoom the link for the detail -->

- [06: Is a Refund capped per Kind, and which Kinds?](issues/06-refund-cap-per-kind.md):
  one uniform bound for `zakat` and `wakaf`, none for `hibah`, decided now —
  the number, the gate-or-observation question, and per-Kind configurability
  are all still open.
- [08: Does a Tim CSR get an account of its own?](issues/08-tim-csr-account.md):
  yes, and it is a term rather than an Assignment — no Campaign, no Payout, no
  Verification Request. Several people may share one company. Whether the
  account is anchored to the person or the company is still open, and so is
  whether a company is verified at all.
- [09: Is the Volunteer module in Release 1?](issues/09-volunteer-in-rilis-1.md):
  yes, with the rule that no half-open loop ships — a Trip that can be created
  must be approvable by a person, and a Volunteer who registers must reach a
  payment and a confirmation. The certificate, the quota warning, the Escrow
  Hold period and the lifecycle fork are all still open.

## Not yet specified

Fog, in coarse patches — sharp enough to know it is in scope, not yet sharp
enough to be a ticket:

- **Which of the eleven missing Admin screens are Rilis 1 and in what order.**
  The list is known; the priority is not, and it depends on which decisions
  below land first.
- **What a person holding two assignments sees.** ADR 0005 removed rank, so
  "an Admin" is not a single thing. Which screens does a person with both
  ADMIN and VERIFIER reach? This shapes every page, and it is not yet clear
  whether it is one rule or several.
- **Whether the Fundraiser pages are complete even ignoring Payout.** There is
  no Campaign Update form in the dashboard, and §7.1's document upload has no
  home on that page either. Whether that is one ticket or two is not sharp
  until the document decision below resolves.
- **Whether FFI-16 (Donor privacy, currently nothing) belongs before or after
  the role pages.** §7.2 assumes an anonymised Donation cannot be refunded,
  and today no Donation can be anonymised, so the rule is vacuous rather than
  wrong. Whether to close that first is a product call.
- **The two numeric questions the PRD does not answer**: whether a Refund is
  capped per Kind and which, and whether the Rp50.000 waiver is a code default
  or Admin configuration. Both need a product answer, but neither blocks a
  decision on this map yet.

## Out of scope

PRD §6 excludes these deliberately. Ruled beyond the destination, and closed
unless the destination is redrawn:

- **Volunteer Trip and volunteer records** (FFI-11, FFI-12, release 3).
- **Two languages** (FFI-15, release 3).
- **Short sharing links**, **WhatsApp notifications**, **Donor-initiated
  refunds**, **automated provider-settlement import**, **accounts for
  organisational team members**.
- **Wallets and AutoDonation** — the code was removed, deliberately.
- **Mobile app, blockchain certificates, automatic volunteer matching,
  accounting-system integration, merchandise marketplace** — excluded with no
  schedule.
