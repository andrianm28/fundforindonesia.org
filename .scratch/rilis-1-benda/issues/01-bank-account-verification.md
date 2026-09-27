# 01: How does a Fundraiser get a bank account, and who says it is theirs?

**Type:** grilling

**Status:** resolved

## Question

A Payout can only go to a `BankAccount` with a `verifiedAt`, and nothing in
the product can create one — `bankAccount.create` does not exist in `src/`
and the only writer is the seed. So the destination of every Payout is
currently uncreatable by a person.

FFI-07 says the Bank Account is "verified through a name check at the
provider where available, or manually by a Verifier". ADR 0006 records that
Sumopod has no disbursement API, so "where available" is almost certainly
false here — but "almost certainly" is not a decision, and the fallback still
has questions of its own:

1. **Who verifies?** "Manually by a Verifier" puts a money-destining check on
   the same role that verifies Campaigns, who may also be the requester.
   ADR 0005 removed rank, so a Verifier who is also the Fundraiser is a
   reachable state, not a theoretical one.
2. **What is recorded, and can it be re-verified later?** A name matched
   against a Bank Statement is a claim about a person that outlives the check.
   Does the verification record what was checked, or only that someone checked?
3. **How many accounts may one person hold, and which is the Payout
   destination?** FFI-07 does not say, and the panel would have to pick.
4. **Does a change of account re-open verification?** A person whose account
   changes has a new destination for money they already earned.

Decide this and the bank-account page can be built. It cannot be built before,
because every one of these changes what the page asks for.

## Notes

`src/lib/field-protection.ts` already encrypts the account number as
randomized ciphertext with no HMAC (same as `User.phone`), and PR #89
established there is **no uniqueness guarantee** on the number — nothing
refuses a duplicate. A decision here should say whether that stays true for
accounts that will be receiving money.

## Answer

Decided 2026-09-27 in two grilling rounds. The destination of a Payout is
created by the person it belongs to, and a Verification Request is what verifies
it. [ADR 0018](../../../../docs/adr/0018-bank-account-born-unverified-verified-by-request.md)
carries the reasoning; `CONTEXT.md` carries the terms.

**Two of the four questions in the ticket were already answered in the repo**,
and asking them again would have produced a decision that looked new and was
not. "Who verifies?" is settled twice over: `CONTEXT.md` defines a Bank Account
as already checked by a Verifier, and ADR 0006 records that Sumopod has no
disbursement API so the provider name check is false before launch, leaving the
manual Verifier check. "Does a change of account re-open verification?" was
settled in `CONTEXT.md` too, which says a change of Bank Account needs a new
Verification Request. What was actually open was narrower: **who writes the
row**, and **what the Verification Request is attached to** -- the schema has no
`VerificationRequest.bankAccountId` and no `BankAccount` relation to one, so the
glossary promised a mechanism that did not exist.

What was decided:

1. **The owner creates it, unverified, on their own profile.** `BankAccount` is
   owned by a `User` and referenced by a `Payout`, not held by a Campaign, so
   the profile is the honest home. It is written with `verifiedAt: null` -- the
   account has to exist before anything can verify it, which rules out letting
   a Verifier type it in on the Fundraiser's behalf: that would make the check a
   statement by the person who entered it, the shape the two-person rule
   refuses everywhere else in the ledger.
2. **A Verification Request references it by id; approval sets `verifiedAt`.**
   No separate bank-account intake surface. The product has one way to hand
   documents to a Verifier and this is not a second one.
3. **Checked once, not per Campaign.** A later Campaign references an account
   that is already verified. Re-checking would queue a Verifier on an unchanged
   fact and charge a Fundraiser with several Campaigns for it repeatedly.
4. **A Verifier may not check a Bank Account they own.** This extends the
   prohibition that already covers Campaigns and Volunteer Trips
   (`CONTEXT.md`, Verifier), and it belongs in the `verifiedAt` write path rather
   than the UI. ADR 0005 removed rank, so a person holding both VERIFIER and
   Fundraiser is a reachable state, not a theoretical one.
5. **A check records what was checked, not only that someone checked.** The bank,
   the name as written on the document, and a free note of one sentence saying
   what was looked at. The note is mandatory: an empty one would leave
   `verifiedAt` a POST with no trace. The document is not uploaded -- that
   belongs to the documents decision.
6. **More than one account is allowed, and uniqueness stays unenforceable.**
   `CONTEXT.md` and ADR 0012 already accept that two encryptions of one number
   can never be compared, because the number is never searched.
7. **Which account a Payout points at is a recorded, changeable decision, and
   that account is the one verified before the Payout is approved.** This is the
   consequence of (6) that the schema explicitly deferred to the owner: a wrong
   destination is caught by a person before money moves rather than by the books
   afterwards.
8. **A Donor's Refund account uses the same flow, verified by a Verifier** even
   though an Admin processes the Refund, because money returned to the wrong
   account cannot be recalled. One rule is cheaper than two.

**Still open, and deliberately not decided here:** what clears `verifiedAt` when
an account turns out to be fraudulent. `payouts.ts:149` and `:250` already refuse
an unverified destination, so a Payout aimed at a cleared account fails; what is
missing is the thing that clears it. And the document upload itself belongs to
[03: Where do submitted documents live, and who may see one?](03-documents.md),
which this ticket unblocked.

**What this cost, stated plainly:** the schema's own comment asks whether the
missing uniqueness guarantee "is the owner's call", and this ticket answers it
-- accepted, with the choice of destination verified instead. That is reliance,
not a fix, and it is written into ADR 0018 so nobody later reads it as an
oversight.
