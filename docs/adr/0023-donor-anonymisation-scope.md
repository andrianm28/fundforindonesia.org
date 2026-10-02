---
status: proposed
---

# What is removed when a Donor is anonymised, and what stays

When a Donor requests their identity removed from their Donation(s), the
decision to carry or drop each field follows a chain: fields that identify the
person are removed; fields that prove money was received and where it went are
kept.

## What is removed

Per Donation:
- Name, email HMAC and ciphertext, phone ciphertext, and the `donorId` link to a
  registered account — the five facts that identify the person.
- The HMAC goes too, even though it is a hash, because it is deterministic: a
  row that carries it is still linkable to every other row carrying the same
  email, across Campaigns and over time.
- `isAnonymous` becomes true. Every public view and Fundraiser view that
  already hides an anonymous Donor hides this one with no further code.
- `anonymisedAt` is stamped so a Refund can refuse itself and a late Receipt
  email can be skipped.

If the Donor is registered, the Prayer they wrote loses its `userId`; its
text stays, because it is shown as the Donation's own.

## What is kept

The Donation row itself (amount, status, Campaign, date, traffic source, ikrar
flag), its Payments, and its Receipt (the print page shows "Donor anonim").
These are financial records the PRD keeps ten years, and nothing in the
anonymisation module reads or writes the ledger.

A finished Refund keeps its recorded destination — bank code, account name, and
sealed number — for the same reason: it is the proof of where returned money
went.

## Scope: Guest and registered

A Guest Donor asks from a link in their Receipt, which covers all Guest
Donations carrying the same email HMAC as that Donation, because leaving the
others would leave the person findable by that HMAC alone.

A registered Donor asks from account settings, for the Donations linked to
their account. The account itself (User row, its name/email/phone) is untouched:
removing an account is a different request.

## Interlock: Refund blocks anonymisation

While a Refund on any of these Donations is not finished (not COMPLETED,
REJECTED, or FAILED), the anonymisation request is refused with 409. The Refund
was approved against the Donor's name, and removing it would strand money
already frozen for return. The refusal and createRefund's own check both run
under the Payment row lock, so a Refund and an anonymisation racing on one
Donation cannot both succeed.

The request can be asked again after the Refund completes.

## Considered options

**Guest scope** (option e): The decision here — anonymise all Guest Donations
with the same email HMAC — means a single Donor receiving a typo in their email
or not protecting their Receipt link exposes every guest Donation they ever
made to anonymisation at once. A recommended alternative: anonymise only the
Donation itself plus add an email confirmation step on the Receipt page, so a
person holding only the token cannot trigger the HMAC-wide scope alone. This
remains open to the owner's review.

## Consequences

- A Guest Donor's identity is removed from all their Donations in one request,
  with no mention of or undo for the others that matched the HMAC.
- A registered Donor's identity is removed from all their own Donations in one
  request, and their account persists.
- An anonymised Donation raises an error on any attempt to refund it through the
  system (createRefund), because the destination was approved against a name
  that no longer exists.
- The message the Donor wrote with their Donation (not their email) stays on
  the Campaign; the Donation item shows "Donor anonim" instead of a name, which
  is already shown for all anonymous Donations.
- No audit log records what was deleted, because the values themselves are gone.
  `anonymisedAt` marks when it happened; Refund and Receipt records mark where
  the money went.
