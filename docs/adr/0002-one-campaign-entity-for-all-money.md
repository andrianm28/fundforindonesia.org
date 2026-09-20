---
status: accepted
---

# One Campaign entity carries every online contribution

Donations, zakat, and wakaf all flow through a single Campaign entity distinguished by a Kind, so the payment, ledger, escrow, payout, and reporting paths are shared. CSR programs are a separate Program catalog that never takes money online, and Volunteer Events are a separate entity because no money moves. We chose this over one entity per contribution path because each extra money path would need its own settlement, escrow, and reconciliation code, and the differences between the paths are rules (fee, required documents, akad) rather than structure.
