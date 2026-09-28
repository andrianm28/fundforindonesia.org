# 28b: There is no Admin panel for Payouts, so approved money cannot leave

**What to build:** A Fundraiser can request a Payout through the product.
Nobody can approve or complete it through the product. The routes exist and
are enforced — `approvePayout` and `completePayout` in
`src/lib/money/payouts.ts` refuse a self-approval, a self-completion and a
suspended subject, under the same Campaign row lock Cancellation takes
(PR #73) — but no screen in `src/app/admin/` calls either of them, and no
`.tsx` references either path. `src/app/admin/` has campaigns,
collecting-entities, partnership-inquiries, users and verification-checklist,
and no payouts at all.

So the two-person rule that FFI-07 is built around is currently only
reachable by calling the API by hand. A Payout raised through the product
sits PENDING until someone outside the product closes it.

**This blocks Release 1.** The plan's own reasoning for putting Payout ahead
of the cutover is that a platform taking public donations with escrow and no
money-out is money in with no way out. Requesting is half of that; the other
half is approving.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] An Admin queue listing Payouts awaiting a decision, with enough on each
      row to judge one: the Campaign, the amount, the Escrow Hold it came out
      of, and what the ledger says the balance is
- [ ] Approving requires the Admin to record the number the Provider's own
      dashboard actually shows, because FFI-07 says the system cannot
      establish that itself and therefore must not pretend to (see the
      open questions below — the column this is recorded in is not decided)
- [ ] Completing requires proof of transfer, and refuses the Admin who
      approved it as well as the Fundraiser who requested it
- [ ] Every action in the panel goes through the same `payouts.ts` commands
      the API uses. The panel must not re-implement the two-person rule or
      the subject guard; that is the whole point of them being commands
- [ ] A finished Payout shows its proof and who did what, on the
      Fundraiser's own screen as well as the Admin's

## Open questions for the owner — these gate the ticket

The provider-balance check (FFI-07: "before approving, the Admin must
check the real balance in the provider's dashboard and record the number on
the Payout") has never been built, and it needs three answers before a panel
can ask for it:

1. **Which column records it?** There is no field on Payout for it today, and
   `field-protection.ts` is in play for anything that reads as contact
   detail. A number is not contact detail, but it is the one number a person
   types by hand from someone else's screen.
2. **Is it a gate or an observation?** Does approving get refused when the
   recorded number does not match the ledger, or is the mismatch recorded and
   approving allowed? FFI-07 reads as a gate. Nothing in the code or the
   tickets has decided it.
3. **What is an operator told to do on a mismatch?** There is no route for
   "I checked, the provider says less than the ledger". Refusing silently
   sends them to the same page forever.

## Comments

- 2026-09-27 (found by the prd-28 builder, PR #94): it went looking for a way
  to make the panel's own request path unreachable by the rules that
  `requestPayout` enforces, and could not find the approving half at all.
  Flagged there rather than absorbed, which is why this is a ticket.
- The same gap exists for a Volunteer Trip Payout, whose approve and
  complete routes were added alongside the Campaign ones and are equally
  unreachable. Volunteer Trip is release 3, so that half is not this
  ticket's business, but the panel should not be built in a way that makes
  adding it awkward.
- prd-28's builder recorded three FFI-07 rules as not executable in a
  Fundraiser's screen, correctly: the provider check, the mismatch
  behaviour, and the two-person rule. This ticket is where the last two
  actually live.
