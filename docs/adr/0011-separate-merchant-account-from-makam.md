---
status: accepted
---

# Fund for Indonesia does not share a payment merchant account with Makam.co.id

The 18 September PRD asked whether payments would run through the same merchant account as Makam.co.id; the 19 September revision dropped the question without answering it. The answer is no: each platform holds its own merchant account at the Payment Provider. Both are built by the same team inside the same group, so sharing is the cheaper and more obvious path, which is exactly why this needs writing down.

## Considered options

- One shared Sumopod merchant account for both platforms. Rejected: donated money held for beneficiaries would settle into the same Provider Balance as another platform's revenue. `GATEWAY_CLEARING` in this repo's ledger is debited on every settlement and is meant to track that balance, so reconciliation would be comparing our books against a pot that is not all ours. The failure would be a quiet drift rather than a loud error.
- A merchant account per platform. Accepted.

## Consequences

- Two provider onboardings, two API keys, two webhook secrets. The active provider and its credentials are per deployment, never shared between the two products.
- Reconciliation can state a real invariant: the Provider Balance equals `GATEWAY_CLEARING` less what an Admin has withdrawn. Nothing credits `GATEWAY_CLEARING` today because no withdrawal is modelled, so that gap has to close before reconciliation asserts anything.
- Commingled funds cannot be unwound after the fact. A settled provider balance carries no record of which platform each rupiah arrived for, so this decision has to hold from the first real payment, not from the first audit.
