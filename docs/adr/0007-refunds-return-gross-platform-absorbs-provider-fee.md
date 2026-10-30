---
status: accepted
---

# Refunds return the gross amount and the platform absorbs the provider fee

A refunded donor gets back exactly what they paid, not what the campaign was credited. The payment provider does not return its fee on a refund, so the difference is a real cost and the platform carries it, booked to a refund-cost account in the ledger. We chose this over refunding the net amount because a donor whose money is returned because the campaign turned out to be fraudulent should not also lose the processing fee, and because a refund that silently shrinks by a percent invites disputes that cost more than the fee.

## Consequences

- The existing ledger builder caps a refund at the net credited to the campaign. That cap must be raised to gross, with the gap debited to the refund-cost account so the books still balance.
- Refund cost becomes a line the platform can total and watch. A campaign generating many refunds is visible as an expense, not just as a support burden.
- Provider fees paid on donations that were later refunded are never recovered, so a high refund rate is a direct loss. That is the intended pressure: it pays to verify campaigns well.

## Amendment 2026-10-30: a Donor may request a Refund

Owner decision E3 (2026-10-04, `.scratch/fase-3-perluasan/issues/04-e3-donor-requested-refund.md`). Until now only an Admin started a Refund. A Donor may now request one on their own Donation, and the Refund still returns Gross exactly as above; nothing about the amount changes. The ticket names ADR 0018, but that ADR is about Bank Accounts; the Refund decision lives here, so the amendment does too.

- A request is only allowed while no Payout of the Campaign has been submitted, approved, started or completed, within a time window after Settlement, under a cap per Kind (a Kind may be closed to requests entirely), and while the Donor has fewer than a set number of requests waiting.
- A request is the same Refund an Admin creates (status `REQUESTED`, money frozen by the same journal), with the Donor as the requester, so the ledger logic is not duplicated and the Admin approves or rejects it on the existing path. It moves no money out of the platform; a Refund that an Admin rejects records the reason.
- The window, the caps and the open-request limit are not recorded in this repository. They are read from the deployment environment, and when any required value is missing or invalid the feature is off. Anti-abuse numbers that are published are numbers to be probed.

