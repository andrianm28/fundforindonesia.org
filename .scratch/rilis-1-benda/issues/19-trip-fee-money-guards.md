# 19: Trip Fee charged with no kill switch, no sandbox-in-production interlock

**Type:** implementation

**Status:** done -- merged in PR #123 (`af6567f`)

**Blocked by:** —

## Question

An audit found that POST on the Volunteer Trip registration route (Trip Fee)
calls `getPaymentProvider()` / `provider.createCharge()` directly, with
neither `donationsEnabled()` nor `sandboxInProductionReason()` in front of it
-- the two guards every other route that takes real money checks first (POST
/api/donations, POST /api/donations/[id]/retry). Flipping the donations kill
switch off, or running with sandbox credentials in production, left Trip Fee
charging anyway.

## Why

The two guards exist for exactly the failure this route was exposed to:
sandbox credentials in production take real rupiah into an account that
settles nowhere, and an emergency switch that only stops some routes taking
money is not an emergency switch.

## Decision

Owner decision 2026-09-28: Trip Fee is stopped by the SAME switch as
Donation -- one emergency switch stops all incoming money, not one per
route. Added the same two checks (`donationsEnabled()`,
`sandboxInProductionReason()`) at the top of the registration route's `POST`,
before the session is read, before the Trip is looked up, before
`holdRegistration` or any write -- same placement and same 503 response
shape (`{ error: DONATIONS_DISABLED_MESSAGE }`) as POST /api/donations.

`src/lib/donations.ts` doc comments updated to say both functions gate every
route that takes money, not only donations; the exported names stay as-is
(`donationsEnabled`, `sandboxInProductionReason`) since they are already used
by two routes and a client page, and renaming them is not this ticket's job.

Checked every other `createCharge` call site
(`git grep -n createCharge -- src ':!*.test.*'`): the only other callers are
`chargeDonation` (used exclusively by the two already-guarded donation
routes) and the provider adapters themselves. No other unguarded route found.

Tests: two new cases in
`src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.test.ts`
-- 503 with nothing held and `createCharge` never called, for the switch off
and for a non-null sandbox-in-production reason.
