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
- A Donation Settlement after expiry must still honour the one-Settlement-per-Donation rule. If a sibling Payment of the same Donation already settled, the late event is not booked: it is marked `SIBLING_ALREADY_PAID` (one of `WEBHOOK_OUTCOMES_NEEDING_REVIEW`) and an Admin refunds that money manually by following [the reconciliation runbook](../runbooks/payment-reconciliation.md). There is no automatic refund of the sibling's money.
- A Payment that is `EXPIRED` while its Registration is still `HOLD` is confirmed on payment, not refunded: the seat is still there, so the expiry cost nothing. Only a Registration already `EXPIRED` or `CANCELLED` is refunded in full.
- The outcome recording a failed automatic Trip Fee refund is `LATE_SETTLEMENT_REFUND_FAILED`; it covers both the expired and the cancelled Registration.

## Follow-up option awaiting an owner decision

- Automatic refund of a sibling Payment, without an Admin. Not implemented. It costs the provider fee (ADR 0007) and a wrong automatic refund cannot be undone, so the owner decides whether it is worth building.
