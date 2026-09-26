# 31: Refund at Gross with a refund-cost account

**What to build:** The ledger can return to a Donor exactly what they paid, with the unrecoverable Provider Fee booked as a platform cost instead of being taken from the Donor.

**Blocked by:** 17

**Status:** ready-for-agent

- [ ] A refund-cost ledger account exists
- [ ] The cap rises from Net to Gross; the existing Net cap and the comment defending it are corrected
- [ ] A covered refund posts four balanced legs, the three debits totalling exactly Gross
- [ ] A partial refund returns fees proportionally, rounded so the pair never exceeds the refunded amount, with the frozen leg taking the remainder and never going negative
- [ ] Where Campaign funds no longer cover it, the shortfall including its fee share is booked to refund cost and the Campaign Balance never goes negative
- [ ] Implements ADR 0007, which the current code contradicts
