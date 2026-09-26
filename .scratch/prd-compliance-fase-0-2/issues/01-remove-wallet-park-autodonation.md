# 01: Remove the wallet and park AutoDonation

**What to build:** The Kantong Donasi wallet disappears from the product. A user can no longer top up or spend a balance, and the platform no longer carries a second, unledgered way for money to reach a Campaign. AutoDonation stops being offered but its data is kept.

**Blocked by:** None (can start immediately)

**Status:** done (wallet and TopUp removed on main; triage 2026-09-26)

- [ ] Wallet top-up and balance-spend are gone from the UI and the API, not merely disabled behind a flag
- [ ] Any outstanding `donationBalance` is honoured or settled before its column is removed; no user silently loses a balance
- [ ] The `TopUp` model and the balance endpoints are removed, with a migration
- [ ] AutoDonation is unreachable from the UI but its rows and model survive untouched
- [ ] No remaining code path can credit a Campaign without posting to the ledger
