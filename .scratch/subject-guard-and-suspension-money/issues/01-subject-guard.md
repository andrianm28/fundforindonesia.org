# 01: One subject guard owns lock-then-read for lifecycle and money

**What to build:** A new subject guard module in `src/lib` becomes the only place that locks and reads a Campaign or Volunteer Trip row. The lifecycle runner, Payout request/approve, Refund create/approve and the Escrow release all go through it, with lock order subject first, then Payment. Payout approval now locks before it reads. There is no behaviour change otherwise. See the spec, section "Subject guard module".

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] `lockAndLoad(tx, subject, now)` returns `{ kind, id, ownerId, isDemo, effectiveStatus }` for both subject kinds
- [ ] `requirePayoutAllowed(state)` and `requireNotOwnerAsAdmin(state, actor)` exist. `requirePayoutAllowed` is not wired into Payouts yet (that is ticket 02); `requireNotOwnerAsAdmin` replaces the Refund owner checks without changing their errors
- [ ] No other file in `src` issues `SELECT … FOR UPDATE` on Campaign or VolunteerTrip; a static guard test proves it
- [ ] `approvePayout` locks before reading the Payout's subject
- [ ] Existing lifecycle, Payout, Refund and Escrow tests stay green, edited only where they asserted raw lock SQL. Full suite green, tsc adds no errors
