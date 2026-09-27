# 01: How does a Fundraiser get a bank account, and who says it is theirs?

**Type:** grilling

**Status:** open

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
