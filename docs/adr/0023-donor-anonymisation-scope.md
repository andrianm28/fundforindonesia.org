---
status: proposed
---

# What is removed when a Donor is anonymised, and what stays

Status per decision: (a) to (d) are **Proposed**. (e), the scope of the Receipt
link, is **Accepted (owner 2026-10-02)**; see "Scope: Guest and registered" and
"Considered options".

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

A Guest Donor asks from a link in their Receipt, which covers **that
Receipt's own Donation only** (decision e, Accepted, owner 2026-10-02). The
Guest must also type the Donation's email address on the Receipt page. The
server normalises it, computes its HMAC with the existing helper, and compares
it with the Donation's `guestEmailHmac` in constant time. Without an email the
request is refused (400); with a wrong one it is refused (403) with a message
that does not say whether the address was close. A repeat is idempotent.

Other Donations with the same email are not touched: they stay linkable to each
other and to an account by their HMAC until each is anonymised on its own.

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

**Guest scope** (decision e, **Accepted, owner 2026-10-02**): the first draft
anonymised every Guest Donation sharing the email HMAC, so anyone holding one
forwarded Receipt link could erase a Donor's whole history. Chosen instead:
anonymise only the Receipt's own Donation, and require the Guest to type the
Donation's email as proof of the inbox. Trade-off accepted: other Donations
with the same email remain matchable by HMAC until anonymised one by one.

## Consequences

- A Guest Donor's identity is removed from one Donation per request, the
  Receipt's own. Their other Donations with the same email stay as they were
  and can still be matched by HMAC until anonymised individually.
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
