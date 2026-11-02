---
status: proposed
---

# Sign-in by a code mailed to the account's address

The owner asked (2 Nov 2026) to replace password sign-in with a one-time code
sent by email. Sign-in now starts with the address; a 6-digit code is mailed to
it and typed back (`src/lib/login-code.ts`, provider `email-otp` in
`src/lib/auth.ts`, request endpoint `POST /api/auth/login-code`).

## Why email alone is enough

"Lupa password" already lets whoever controls an address set a new password and
sign in (rilis-1 93), so the address has been the real root of every account.
A mailed code does not weaken that; it removes the password as a second, weaker
way in and the reuse risk that comes with it.

## Shape

- `LoginCode` stores a keyed HMAC of the code (key derived from
  `NEXTAUTH_SECRET` under its own domain, account id in the MAC). A 6-digit code
  has a million values, so a plain hash in a dump would not protect it.
- A code lives 10 minutes, is spent by a conditional update (one winner among
  concurrent sign-ins), dies after 5 wrong guesses, and is retired when a newer
  code is issued. It carries the address HMAC at issue and stops working if the
  address changes (ADR 0020).
- Issuing has a 60-second cooldown per account; the request endpoint counts per
  client and per address HMAC before any lookup, fails closed (it sends mail),
  and answers every valid address the same way. The provider counts attempts per
  client + address and per client, fail-open like the password login, because
  the per-code limit in the database still holds.
- A successful sign-in sets `emailVerifiedAt` when empty: typing back the code
  proves the address exactly as the confirmation link and a password reset do.
  Like the password reset, it does not run the Guest Donor claim; the
  confirmation link remains the path that claims history.
- Registration takes a name and an address, no password; the account is signed
  in by its first code.

## Open (owner decision cards, 2 Nov 2026)

- Whether the password form stays as a fallback until after launch (built that
  way, behind a "Masuk dengan password" link) or is removed now.
- Whether Admin and Verifier accounts need password + code.
