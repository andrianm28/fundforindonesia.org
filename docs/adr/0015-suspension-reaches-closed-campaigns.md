---
status: accepted
---

# Suspension reaches Expired and Completed Campaigns, not only Active ones

PRD §8 draws Suspended as a branch from Active only. We let an Admin suspend a Campaign that is Active, Expired, or Completed, and lifting the Suspension returns it to the status it came from (an Active one whose deadline passed meanwhile lands on Expired). Fraud is most often discovered after a Campaign has stopped collecting, while its Campaign Balance is still unpaid; if only Active could be suspended, a Fundraiser caught two weeks after the deadline could still request a Payout, and the §7.2 Refund trigger "Suspension karena penyalahgunaan: seluruh Payment yang dananya belum keluar" could never fire for exactly the Campaigns it exists for.

## Consequences

- Completed stays final in every other respect: Suspension is its only way out, and lifting a Suspension on a Completed Campaign returns it to Completed, never to Active.
- Lifting needs the status before the Suspension, so it is read from the Campaign's status-change record rather than stored as a column.
- The PRD text is now narrower than the system; PRD §8 should be amended to match.
