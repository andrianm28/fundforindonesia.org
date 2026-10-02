---
status: accepted
---

# A Donation paid after its Payment expired still settles; a Trip Fee with no seat is refunded

When a provider reports `paid` for a Payment already `EXPIRED` or `FAILED`, a Donation Payment is settled and credited to the Campaign, not refunded; a Trip Fee whose seat is gone is refunded in full through the late-settlement path. The Donor demonstrably meant to give and the money has arrived, and a Campaign has no scarce resource that expiry protected, so refunding would only return a gift the Donor wanted made. A Trip Fee buys a seat that may now belong to someone else, so keeping the money would charge for nothing. Decided by the owner (Dri) on 2026-10-02 after the builder implemented it in PR #180 (`rilis-1-benda/issues/52`).

## Considered Options

- Refund every paid-after-expiry Payment uniformly: simplest rule, but it turns away a Donor's completed gift and costs the platform the provider fee (ADR 0007).
- Settle Donations, refund Trip Fees (chosen).

## Consequences

- Settlement can follow expiry for a Donation, so "EXPIRED" means "no longer awaiting payment", not "can never be paid".
- A Donation Settlement after expiry must still honour the one-Settlement-per-Donation rule; a sibling already settled still means refund.
