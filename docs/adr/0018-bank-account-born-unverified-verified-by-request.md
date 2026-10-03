---
status: accepted
---

# A Bank Account is born unverified on the Fundraiser's own profile, and a Verification Request is what verifies it

Nothing in the product could create a `BankAccount`: `bankAccount.create` did
not exist in `src/`, the only writer was the seed, and a Payout refuses a
destination without a `verifiedAt` (`src/lib/money/payouts.ts`). So the
destination of every Payout was uncreatable by a person, which made PR #94's
Payout screen unreachable and left nine of Admin's thirteen jobs untestable.

The account is added by its owner, on their own profile, with no
`verifiedAt`. A Verification Request then references it, and a Verifier
approving that request sets `verifiedAt`. The account is checked once: later
Campaigns reference an account that is already verified rather than putting the
same Fundraiser's unchanged bank details in front of a Verifier again. The same
flow serves a Donor's Refund destination, verified by a Verifier rather than an
Admin, because money returned to the wrong account cannot be recalled.

## Considered options

- A Verifier types the account in on the Fundraiser's behalf. Rejected: the
  check would then be a statement by the same person who entered it, which is
  the shape the two-person rule exists to refuse everywhere else in the ledger.
- A separate bank-account registration page with its own intake and its own
  queue. Rejected, though not for the reason first written here. The product does
  **not** have one way to hand work to a Verifier: it has two, Verification
  Request for Campaigns and Volunteer Trip moderation for Trips, each with its
  own `SUBMITTED` queue and the same refusal to act on one's own. The real
  reason is one queue per subject rather than one queue overall: a Bank Account
  belongs to a subject that already has a queue, and a third intake would be a
  third place to look, a third thing to staff, and a third place for the
  subject-conflict rule to be forgotten. Piggybacking also inherits that rule
  instead of re-deciding it.
- A provider name check. Not available: ADR 0006 records that Sumopod has no
  disbursement API, so "verified through a name check at the provider where
  available" is false for the only provider before launch.
- Re-checking the account on every Campaign. Rejected: it queues a Verifier on
  an unchanged fact, and it would make a Fundraiser with several Campaigns pay
  for it repeatedly.
- Guaranteeing the account number is unique. Rejected, and it stays rejected:
  ADR 0012 stores a randomized ciphertext that is never searched, so two
  encryptions of one number can never be compared. The guarantee needs a keyed
  lookup that ADR 0012 deliberately does not have.

## Consequences

- The absence of a uniqueness guarantee is now load-bearing for a payout
  destination, and the schema says so. A Fundraiser may hold two Bank Accounts
  with the same number and nothing will say so, so **which account a Payout
  points at is a recorded, changeable decision, and that account is the one
  verified before the Payout is approved.** A wrong destination is caught by a
  person before money moves, not by the books afterwards.
- `verifiedAt` is only ever written where a Verifier approves, and never for an
  account that Verifier owns. The prohibition already covering Campaigns and
  Volunteer Trips extends to Bank Accounts, and it belongs in the write path
  rather than in the UI.
- A check records the bank, the name as written on the document, and a free note
  of what was looked at. `verifiedAt` alone would be a POST with no trace, which
  is the thing to avoid in a decision that sends money to one account.
- The document itself is not uploaded here. That belongs to the documents
  decision, and a note is enough to make the decision auditable.
- Clearing `verifiedAt` when an account turns out to be fraudulent is a separate
  piece of work and is not implied by this decision. `payouts.ts` already
  refuses an unverified destination, so a Payout aimed at a cleared account
  fails; what is missing is what clears it.

## Amendment 2026-09-28

This ADR's own text already says a Refund's destination is "verified by a
Verifier rather than an Admin" -- the same Bank Account flow as a Payout's.
Ticket 31 could not build that: Rilis 1's Guest Donors have no account of
their own to add a Bank Account to and submit for a Verifier's queue, so
there is nothing for a Verifier to check. Owner decision Q7(c),
2026-09-28: for Rilis 1 only, a Refund's destination is exempted from the
Verifier check this ADR otherwise requires, and a compensating control
takes its place -- two pairs of eyes on the account number, the same shape
the rest of the ledger already uses for money leaving the platform
(createRefund/approveRefund/completeRefund's own three-Admin rule).

- The Admin who **approves** a Refund records the destination -- bank code,
  account holder name, account number -- straight from the Donor's written
  request. This moved here from completion, where ticket 31 first put it:
  an approval with no destination is now refused.
- The Admin who **completes** the Refund, a different Admin again, does not
  type a fresh destination. They re-type only the account number from the
  same written request, and the server compares it against the one sealed
  at approval (decrypted server-side, digits normalised, compared in
  constant time) -- a mismatch refuses the completion and writes nothing.
  Neither the approve form nor the complete form ever renders the full
  number back; only a masked tail is shown, the same mask the Bank Account
  verification queue already uses.
- This is a Rilis 1 exception, not a reinterpretation of the rule above.
  Once a Donor can hold a Bank Account on their own profile, a Refund's
  destination goes back to full Verifier verification, exactly as this
  ADR's original text describes, and this exception is retired.
