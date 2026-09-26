# 35: Collection account, provider withdrawal and per-provider reconciliation

**What to build:** The difference between money sitting at the provider and money in the bank becomes visible every day instead of being assumed away.

**Blocked by:** 27

**Status:** ready-for-agent

- [ ] A collection account exists in the ledger, distinct from the Merchant Account and able to belong to a different legal entity
- [ ] An Admin records a withdrawal from the provider to the collection account as a balanced journal
- [ ] Reconciliation runs per provider and reports the provider balance against the ledger
- [ ] Ledger entries carry Kind and provider so reporting works per licence and per provider
- [ ] Supports the invariant ADR 0011 depends on
