---
status: accepted
---

# Any write that changes a User's email also resets `emailVerifiedAt`

`User.emailVerifiedAt` says that the account's *current* address was confirmed
by a link sent to it (prd-compliance 23). It is the only thing that lets an
account claim a Guest Donor's history under that address, and a claim hands
over Donations and their Receipts. So the timestamp is a statement about one
address, not about the account: if the address changes and the timestamp stays,
the account holds a confirmation for an address it never proved, and can claim
the history of whoever owns the new one.

The invariant: **every write to `email` or `emailHmac` on a User sets
`emailVerifiedAt: null` in the same write.** A confirmation token carries the
HMAC of the address it was issued for, and confirming it matches that HMAC in
the `where` of the User write, inside the same transaction that spends the
token, so a link sent to an older address cannot verify a newer one.

Nothing in `src/` changes a User's email today (the profile route writes only
`name`; the adapter creates users, which are born unverified). A future
change-email feature must reset the timestamp, and
`src/__tests__/email-verified-reset.test.ts` fails the build on a `user.update`
that writes `email` or `emailHmac` without `emailVerifiedAt`.

## Considered options

- A database trigger that nulls `emailVerifiedAt` when `emailHmac` changes.
  Rejected for now: the repo has no triggers, and the write path is a single
  Prisma extension plus a handful of call sites. The scan test is cheaper and
  visible in review. Revisit if a second writer of the address appears.
- Deriving verification instead of storing it (store the HMAC that was
  verified, compare with the current one). Sound, and avoids the reset, but
  changes the schema and every reader for a case that cannot occur yet.

## Consequences for the Guest Donor claim

- **Anonymised Donations cannot match.** The claim
  (`src/lib/guest-donation-claim.ts`) matches `guestEmailHmac` and its key id.
  Anonymising under FFI-16 (ticket 36, PR #172) clears that HMAC and sets
  `Donation.anonymisedAt`; both `where`s also require `anonymisedAt: null`, so
  such a row is never found (ticket 23, Comments).
- **Key rotation fails safe.** The key id is part of the match, on the read and
  on the write. A guest Donation sealed under an older HMAC key id is not
  claimed by an account whose lookup is under a newer one. It stays unclaimed
  until the Donation's HMAC is re-keyed; nothing is ever claimed wrongly.
  `src/__tests__/integration/guest-donation-claim-real-db.test.ts` asserts it.
