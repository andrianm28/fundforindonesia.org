---
status: accepted
---

# One Campaign entity carries every online contribution

Donations, zakat, and wakaf all flow through a single Campaign entity distinguished by a Kind, so the payment, ledger, escrow, payout, and reporting paths are shared. CSR programs are a separate Program catalog that never takes money online, and Volunteer Events are a separate entity because no money moves. We chose this over one entity per contribution path because each extra money path would need its own settlement, escrow, and reconciliation code, and the differences between the paths are rules (fee, required documents, akad) rather than structure.

**Update, 22 September 2026:** the Volunteer clause above is now only half true — Volunteer (renamed Volunteer Trip) still moves through a separate entity, but no longer because no money moves; it now charges a Trip Fee. See [ADR 0014](./0014-volunteer-trip-stays-separate-entity.md) for why the entity stayed separate anyway. This paragraph is left otherwise unedited as the historical record of the original decision.
