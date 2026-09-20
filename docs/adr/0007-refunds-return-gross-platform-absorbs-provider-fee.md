---
status: accepted
---

# Refunds return the gross amount and the platform absorbs the provider fee

A refunded donor gets back exactly what they paid, not what the campaign was credited. The payment provider does not return its fee on a refund, so the difference is a real cost and the platform carries it, booked to a refund-cost account in the ledger. We chose this over refunding the net amount because a donor whose money is returned because the campaign turned out to be fraudulent should not also lose the processing fee, and because a refund that silently shrinks by a percent invites disputes that cost more than the fee.

## Consequences

- The existing ledger builder caps a refund at the net credited to the campaign. That cap must be raised to gross, with the gap debited to the refund-cost account so the books still balance.
- Refund cost becomes a line the platform can total and watch. A campaign generating many refunds is visible as an expense, not just as a support burden.
- Provider fees paid on donations that were later refunded are never recovered, so a high refund rate is a direct loss. That is the intended pressure: it pays to verify campaigns well.
