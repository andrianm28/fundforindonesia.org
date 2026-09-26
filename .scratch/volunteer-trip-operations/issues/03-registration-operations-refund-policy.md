# 03: Registration operations and one Trip Fee Refund policy

**What to build:**
- `holdRegistration`, `confirmRegistration`, `cancelRegistration` and `expireRegistrationHolds` move into the Volunteer Trip module.
- The webhook's Settlement and expiry paths, the Volunteer cancel route, Batch cancel and the expiry sweep all call the module, so nothing else writes Registration status.
- One Trip Fee Refund policy decides the amount and reason for all three cases:
  - tiered on Volunteer cancel, via `tripFeeRefundAmount`;
  - full on Batch cancel;
  - full automatically when a payment settles after the Registration was cancelled.

See the spec and CONTEXT.md (Trip Fee).

**Blocked by:** 02

**Status:** done

- [ ] Only the module writes Registration status; a static guard pins it
- [ ] One policy function covers the three Refund cases, with tests for the tier boundaries, full Refund on Batch cancel, and full Refund on late settlement
- [ ] Webhook, sweep and route tests shrink to "calls the operation, maps the result", and existing behaviour is unchanged
- [ ] Full suite green, tsc adds no errors
