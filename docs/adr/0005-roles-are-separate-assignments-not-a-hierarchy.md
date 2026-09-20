---
status: accepted
---

# Verifier and Admin are separate assignments, not a hierarchy

The code today ranks roles DONOR < CAMPAIGN_CREATOR < MODERATOR < ADMIN, so every Admin can verify campaigns by default. We are replacing that with independent assignments: Verifier (moderation and identity checks) and Admin (payouts, reconciliation, user roles), which one person may hold both of. With a small operator team the hierarchy would silently make every Admin a Verifier and the audit trail would not show who was acting in which capacity. The two-person rule on Payouts applies to the person, not the role.
