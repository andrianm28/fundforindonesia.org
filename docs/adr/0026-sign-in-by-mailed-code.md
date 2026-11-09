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
  concurrent sign-ins), and each guess claims one of its 5 attempts in a
  conditional update before it is compared, so concurrent guesses cannot
  exceed the limit. It and is retired when a newer
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
- Registration takes a name and an address and accepts no password; the
  account is signed in by its first code. A password chosen at registration
  would be chosen by whoever typed the address (pre-registration takeover).
  For the same reason the first code sign-in of an account that never proved
  its address clears any password it carries, which also ends every session
  issued under that password (`pwf` claim).

## Accepted risks

- **Targeted lockout.** Anyone can ask for a code for any address. Each
  request retires the previous code and spends the address's hourly budget (5),
  and wrong guesses kill a code. A stranger can therefore keep one person from
  signing in by code for a while. Google sign-in and, while it stays, the
  password fallback remain; the per-address and per-client limits bound how
  much mail this sends. Revisit if it is seen in practice.
- **Sessions of passwordless accounts** cannot be ended by changing a password,
  because there is none: the `pwf` claim is the same for every such session.
  Ending sessions on demand needs a session version column; not in this change.

## Operators: the code replaces MFA

The owner decided (9 Nov 2026) that the mailed code is the operators' second
factor for PKS Pasal 8(1), in place of a separate TOTP MFA. So an account
holding any Assignment (Admin, Verifier) signs in only by code: the password
form refuses it after checking the password (so a stranger learns nothing
about the role), and a Google sign-in into such an account is sent back to
`/login?error=OperatorCodeOnly`.

## Open (owner decision card, 9 Nov 2026)

- Whether the password form stays as a fallback for everyone else until after
  launch (built that way, behind a "Masuk dengan password" link) or is removed
  for everyone now.
