---
status: proposed
---

# Sign-in by a code mailed to the account's address

The owner asked (2 Nov 2026) to replace password sign-in with a one-time code
sent by email. Sign-in now starts with the address; a 6-digit code is mailed to
it and typed back (`src/lib/login-code.ts`, provider `email-otp` in
`src/lib/auth.ts`, request endpoint `POST /api/auth/login-code`).

## Why email alone is enough

The password reset (rilis-1 93, now removed) already let whoever controls an
address set a new password and sign in, so the address has been the real root
of every account. A mailed code does not weaken that; it removes the password
as a second, weaker way in and the reuse risk that comes with it.

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
  client + address and per client, fail-open, because
  the per-code limit in the database still holds.
- A successful sign-in sets `emailVerifiedAt` when empty: typing back the code
  proves the address exactly as the confirmation link does. It does not run
  the Guest Donor claim; the confirmation link remains the path that claims
  history.
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
  signing in by code for a while. Google sign-in remains; the per-address and per-client limits bound how
  much mail this sends. Revisit if it is seen in practice.
- **Sessions of passwordless accounts** cannot be ended by changing a password,
  because there is none: the `pwf` claim is the same for every such session.
  Ending sessions on demand needs a session version column; not in this change.

## Operators: the code replaces MFA

The owner decided (9 Nov 2026) that the mailed code is the operators' second
factor for PKS Pasal 8(1), in place of a separate TOTP MFA. So an account
holding any Assignment (Admin, Verifier) signs in only by code: a Google
sign-in into such an account is sent back to `/login?error=OperatorCodeOnly`,
and the login page shows "Akun Admin/Verifier masuk dengan kode email."

Refusing at sign-in is not enough on its own, so the session records how it
was signed in (`amr` on the JWT, the provider id) and the jwt callback grants
Assignments only to an `email-otp` session. A Google session whose account is
granted an Assignment later, and every session from before this rule, keeps working as an ordinary account with no authority until its holder
signs in again by code. After the deploy, Admins and Verifiers sign in once
more, by code.

## Decision: no password for anyone (owner, 9 Nov 2026)

The open question (keep the password form as a fallback for ordinary accounts
until after launch, or remove it) is closed: "Hapus password untuk semua". The
`credentials` provider, the login page's password form and toggle, the forgot
and reset password flow (pages, routes, mail, token) and the settings page's
change-password section are removed. Everyone signs in by mailed code or
Google. The `User.password` column stays (no migration); nothing writes it and
the first code sign-in of an unverified account still clears it. The `pwf`
session claim stays, so a session still ends if a stored hash ever changes.
`next.config.mjs` header rules and the error-monitoring scrub for
`/reset-password` stay, to protect links already mailed.
