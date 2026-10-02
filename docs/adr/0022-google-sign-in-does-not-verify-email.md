---
status: accepted
---

# Signing in or registering with Google does not verify the email

Google sign-in is not treated as proof that the account owns the email address, so guest Donation history is claimed only after the account confirms its email through a link sent to that address. Registering with someone else's email stays allowed, but it claims nothing. We chose this over trusting Google's email claim because the claim hands a person the giving history of whoever owns that address, and a wrong claim exposes a Guest Donor's identity and cannot be undone once seen. The cost is one extra confirmation step for Google users. Decided by the owner (Dri) on 2026-10-02 after the builder implemented it in PR #186 (`prd-compliance-fase-0-2/issues/23`).

## Considered Options

- Trust Google's verified-email claim: fewer steps, but couples privacy to a provider claim we do not control.
- Always require our own confirmation link (chosen).

## Consequences

- Every account, whatever its sign-in method, starts with `emailVerifiedAt` empty.
- Changing the email clears verification (ADR 0020).
