# 28: Fundraiser Payout UI

**What to build:** A Fundraiser can see what is held, what is available, and ask for it, without anyone touching the database.

**Blocked by:** 27

**Status:** done (PR #94, fec1d02)

- [x] Escrow Hold and Campaign Balance are shown separately and computed from the ledger
- [x] A partial Payout may be requested while the Campaign is Active
- [x] Payout status is visible to the Fundraiser throughout
- [x] Requesting against a verified Bank Account only

## Comments

- 2026-09-27 (implementation): `GET /api/user/campaigns/[slug]/payouts` reads
  `escrowBalance` and `campaignBalance` from the ledger, never
  `Campaign.collectedAmount`; it runs `releaseMaturedEscrow` for the Campaign
  first, exactly as the request handler does, so the figure on screen is the
  figure a request a second later is judged against. The screen is
  `/akun/kampanye-saya/[slug]/pencairan`, reached from a "Cairkan dana" link
  on each Campaign card.

- 2026-09-27 (decision, recorded not guessed): **three FFI-07 rules cannot be
  executed in this UI and are not faked anywhere in it.**
  1. *The provider-balance check before approval.* FFI-07 says an Admin must
     check the real balance in the provider dashboard and **record the number
     on the Payout**. There is no field on `Payout` to record it in, and no
     code reads one. So the check has no home in the schema, let alone in a
     screen. This panel does not display, request, or imply it.
  2. *What happens when the provider balance does not match the books.* Not
     written down anywhere in the PRD, CONTEXT.md, or the ADRs. Whether a
     mismatch blocks approval, allows it with a flag, or forces a
     reconciliation first is a money decision, not an implementation detail.
  3. *The two-person rule.* Approve (not the requester) and Complete (a
     different Admin, with proof) are Admin acts under the subject guard. The
     Fundraiser screen has no control that can perform either, by design.

- 2026-09-27 (gap found, not fixed here): **there is no Admin panel for
  Payouts at all.** `POST /api/campaigns/[slug]/payouts/[id]/approve` and
  `.../complete` exist and are enforced (PR #73), but nothing in `src/app/admin`
  calls them, and no `.tsx` file references either path. So today a Payout a
  Fundraiser requests can be created but **cannot be approved or completed
  through the product** — the only way through is calling the API by hand.
  That is a release blocker for Rilis 1, and it is a separate ticket: this one
  is the Fundraiser's side of the screen. The FFI-07 provider-balance check
  above belongs in that panel, which is the other reason it is not invented
  here.

- 2026-09-27 (owner question, blocking the Admin panel): to record the
  provider's real balance on a Payout, three things have to be decided first.
  **(a)** Which column — a nullable `Int` on `Payout`, or a separate row per
  check? **(b)** Is the recorded figure a gate (approval refused when it is
  short) or an observation (recorded, and a human reads it)? **(c)** On a
  mismatch between the provider figure and the ledger, what is the operator
  told to do? Until (a)-(c) are answered, the check cannot be built, and
  building it as a soft advisory would be inventing money behaviour.
  FFI-07's own words are "mencatat angkanya pada Payout" — record, not
  compare — so the PRD states the obligation and not the consequence.

- 2026-09-27 (scope note): `Program Balance` is unreachable from this screen
  by construction, not by omission — `Payout` has no `programId` column at
  all. `manual-contribution-isolation.test.ts` gained a case that scans every
  `.tsx` mentioning a Payout for `PROGRAM_BALANCE`/`programBalance`, so a
  future Payout screen cannot quietly introduce one.

