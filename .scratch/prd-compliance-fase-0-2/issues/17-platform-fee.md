# 17: Platform Fee configuration and ledger posting

**What to build:** The platform starts earning. An Admin sets the fee, a Donor sees it before paying, and every settled Donation posts it to the ledger, where today the account exists and is never written to.

**Blocked by:** 9

**Status:** done (PR #33, 397ebdc)

- [ ] Fee resolves per Campaign, then per Category, then per Kind default
- [ ] Waived below an Admin-set threshold, so a small gift carries only the Provider Fee
- [ ] Rounded down, so the remainder falls to the Campaign and never to the platform
- [ ] Posted to the Platform Fee ledger account on Settlement, with entries balanced
- [ ] Changes apply only to Donations made afterwards; every change records who and when
- [ ] The rate in force is shown on the Campaign page
