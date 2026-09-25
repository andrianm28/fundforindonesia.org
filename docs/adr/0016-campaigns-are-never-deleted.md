---
status: accepted
---

# Campaigns are never deleted

A Campaign stops through its lifecycle, never by deletion: a Fundraiser withdraws through Cancellation, which an Admin approves; an Admin freezes a Campaign through Suspension; and a Campaign that has run its course is Expired or Completed. We removed the Campaign DELETE endpoint and the Admin delete button rather than restricting them. Once a Campaign has been submitted it is a public and financial record: Donors, Verifiers, the status-change log and the ledger all refer to it. Deleting it silently took its pending Donations with it and bypassed the Cancellation approval that PRD §8 requires.

## Considered options

- Keep DELETE for the owner while the Campaign is still Submitted and has no Donation ("withdraw my submission"). Rejected: withdrawing an unreviewed submission is a real need, but it belongs to Verification Request (ticket 12 of prd-compliance-fase-0-2), where a withdrawn submission stays on record like a rejected one.
- Keep DELETE for Admins only. Rejected: no operator task needs it that Suspension or Cancellation doesn't already cover, and a destructive shortcut for operators is exactly what the two-person rules elsewhere avoid.

## Consequences

- Architecture review candidate 6 ("Campaign deletion becomes a lifecycle command") is settled by removal, not by a command.
- Demo or test Campaigns created by mistake are handled in the database by an operator, deliberately, not through the product.
