---
status: accepted
---

# Provider-neutral payment layer: Sumopod before launch, many providers after

Before launch the only real payment provider is Sumopod. It offers QRIS through a hosted payment-link page, signs webhooks with an svix-style HMAC, and has no disbursement API: payouts are done by hand in the Sumopod dashboard, straight to the recipient's bank account. After launch the owner wants Midtrans, Xendit, DOKU, Stripe, and others switched on from the Admin dashboard. So the payment layer stays behind one provider interface, every Payment records which provider it went through, each provider has its own webhook route and signature check, and reconciliation runs per provider.

## Consequences

- The existing Midtrans-style webhook signature code and the Xendit-shaped payout contract are kept as two adapters, not thrown away.
- Provider fees are real and must be read from each provider's payload. The current webhook hardcodes a zero provider fee; that becomes wrong the moment Sumopod is live, because Sumopod reports `fee` and `net_amount` on every event.
- Funds sit in the provider's balance until an admin withdraws them, so the ledger needs an account per provider balance. Without it the books would claim money is in a bank account that has not received it yet.
- A payout has no provider call. The approval step posts the instruction legs, a second admin then withdraws in the Sumopod dashboard and marks the payout completed with proof. The two-person rule and the mandatory proof are the only controls, so neither is optional, and neither is dropped when a provider with a disbursement API is added later.
- Bank account name validation is per provider. Sumopod has none, so a verifier checks manually until a provider that offers it is active.
