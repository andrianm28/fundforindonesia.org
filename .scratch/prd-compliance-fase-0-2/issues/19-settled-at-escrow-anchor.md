# 19: Provider settlement time anchors the Escrow Hold

**What to build:** The hold on a Donation counts from when the provider actually settled it, not from when our server happened to receive a webhook.

**Blocked by:** 18

**Status:** in review (PR #51)

- [x] A settlement timestamp is stored on the Payment, read from the provider payload
- [x] Escrow release is computed from provider settlement, not server receipt time
- [x] The frozen hold duration on the Payment continues to govern, so changing the default cannot move an existing Payment's release
- [x] Matches the Sumopod integration notes, which already require this

## Comments

Implemented in PR #51. `Payment.settledAt` (new nullable column, migration
`20260927050000_add_payment_settled_at`) stores the provider's settlement
estimate from the signed webhook payload; `escrowReleaseAt` is computed from
it instead of server receipt time. `WebhookEvent.paidAt`/`settledAt` are now
required on `PaymentProvider`, so each adapter (Sumopod, Mock) decides its
own T+0 fallback explicitly rather than the escrow layer guessing one.
`escrowHoldDays` (ticket 18) is unchanged.

Assumption flagged in the PR for owner review: a missing/malformed provider
timestamp degrades to T+0 rather than failing the webhook closed -- no
existing policy doc says otherwise either way.
