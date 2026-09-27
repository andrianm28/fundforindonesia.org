# 10: If nobody requests a Payout, when is matured escrow released?

**Type:** grilling

**Status:** open

## Question

`runScheduledJobs` exists in `src/lib/scheduled-jobs.ts` and is called from
nothing: no route, no script, no workflow. The only two live calls to
`releaseMaturedEscrow` are the Payout request routes —
`src/app/api/campaigns/[slug]/payouts/route.ts:58` and
`src/app/api/volunteer-trips/[slug]/payouts/route.ts:55`. So matured escrow is
released **as a side effect of a Fundraiser asking for money**, and never
otherwise.

That was not always true. prd-compliance 28 used to call `releaseMaturedEscrow`
from the read-only Payout route, so merely opening the page released it. That
call was removed as scope creep, because `spec.md:185` says release runs on a
schedule and keeps the lazy sweep as a second path — and the two
`payouts/route.ts` files above are that lazy sweep.

What is left is the consequence nobody owns: a Campaign whose Payment passed
its Escrow Hold shows a Campaign Balance lower than the ledger holds, and stays
that way until somebody requests a Payout. `CONTEXT.md` defines Campaign Balance
as always computed from the ledger, so the figure is correct and **late**, which
is a different thing and reads as a bug to a Fundraiser.

The three questions that have to be answered together:

1. **Is a scheduler in Release 1, or is the lazy sweep the whole of Release
   1?** prd-compliance 20 built `runScheduledJobs` and 45 was to trigger it;
   neither is merged. If Rilis 1 does not ship a trigger, the lazy sweep is not
   a second path — it is the only path, and the spec's wording is what has to
   change.
2. **If the sweep stays, should it also run on a read?** It was removed for
   being a third path, not for being wrong. A read that releases money is a
   legitimate lazy sweep, and its cost is that a GET can move money.
3. **Who is told when a balance is late?** Nothing surfaces it. The Admin
   reconcile report can see a Payment whose `escrowReleasedAt` is unset, but
   there is no marker on the Campaign and no one is paged.

## Notes

Surfaced 2026-09-27 by the review of prd-compliance 28 (PR #94), and confirmed
against the code: `grep -rn "runScheduledJobs" src/` returns only the definition
and comments. Not a decision ticket about the scheduler's design — that belongs
to prd-compliance 20 and 45. This ticket decides whether Rilis 1 is allowed to
ship with the consequence at all, because the destination needs a donation to
reach a verified bank account, and a Fundraiser who cannot see their real
balance cannot ask for it.

Related: prd-compliance 35 (PR #93) touches the same report for the provider
pot rather than the escrow sweep.
