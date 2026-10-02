# 36: Donor anonymisation

**What to build:** A Donor can have their identity removed without the platform losing its accounting.

**Blocked by:** 16

**Status:** in-review (PR #172)

- [ ] Name, email and phone are anonymised on request, including the HMAC and ciphertext
- [ ] Amounts and ledger entries are untouched
- [ ] A Guest Donor requests it from a link in their Receipt; a registered user from account settings
- [ ] An anonymised Donation can no longer be refunded through the system, and says so
