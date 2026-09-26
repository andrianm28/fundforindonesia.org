# 02: Suspension freezes Payouts and Escrow release

**What to build:**
- A Payout is requested and approved only while its Campaign is effectively Active, Expired or Completed.
- Suspended and Cancelled refuse it (409, typed code, Indonesian message), even when the Suspension lands between request and approval.
- The Escrow release sweep leaves a Suspended Campaign's matured money in Escrow Hold and releases it on the first sweep after a lift.
- Refunds stay possible on a Suspended Campaign.
- Volunteer Trips behave exactly as today.

See the spec, section "Suspension effects", and CONTEXT.md (Payout, Escrow Hold).

**Blocked by:** 01

**Status:** done

- [ ] `requestPayout` and `approvePayout` call `requirePayoutAllowed` inside the lock. A table test covers every Campaign effective status for both
- [ ] A Suspension committed before approval's lock refuses the approval, and the Payout stays as it was
- [ ] Escrow sweep: a Suspended Campaign's matured money stays in hold (no ledger legs); after a lift it is released; Trips are unaffected
- [ ] `createRefund`/`approveRefund` still succeed on a Suspended Campaign
- [ ] Payout routes answer 409 with the typed code. Full suite green, tsc adds no errors
