# 23: Guest Donor history claim

**What to build:** Someone who gave as a guest and later registers finds their past gifts waiting, and nobody can claim anyone else's.

**Blocked by:** 16, 18

**Status:** ready-for-agent

- [ ] History appears only after the account's email is verified by confirmation link
- [ ] Matching goes through the email HMAC, never a decrypted scan
- [ ] An unverified account sees nothing, however the email matches
