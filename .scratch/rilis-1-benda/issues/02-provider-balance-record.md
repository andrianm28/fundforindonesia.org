# 02: Where is the provider's real balance recorded, and is a mismatch a gate?

**Type:** grilling

**Status:** resolved

## Question

FFI-07 says: before approving a Payout, the Admin **must** check the real
balance in the provider's dashboard and **record the number on the Payout**,
because the system cannot establish it itself and therefore must not pretend
to. This is the one mechanism the PRD offers in place of a balance API.

None of it exists. `approvePayout` takes two arguments and a Payout has no
column for the number. Three questions, and the first one is genuinely
blocking:

1. **Which column carries it?** It is a number a person types by hand from
   someone else's screen, next to a figure the system computed. That is a
   different kind of value from anything else on the row, and it is the kind
   that ends up in a screenshot and a dispute. What is it, where does it
   live, and is it encrypted under ADR 0012 or is it not contact detail at
   all?

2. **Is a mismatch a gate or an observation?** Does approving get **refused**
   when the recorded number is less than the ledger's, or is the difference
   recorded and approving allowed? FFI-07 reads as a gate. Nothing has decided
   it, and the code's own comment says this is "a change of one line" —
   which is a sign that nobody has actually made the choice.

3. **What is the operator told on a mismatch?** There is no route for "I
   checked, the provider says less than the ledger". A silent refusal sends
   the same person to the same page forever, with no way to record that they
   looked.

Decide these and the Admin Payout panel can be built honestly. It should not
be built before: a screen with an empty field on it teaches operators that the
check is a formality, which is the exact failure FFI-07 is trying to prevent.

## Answer

Owner (Dri), 2026-09-28, in the batch grilling round
([grilling-borongan-2026-09-28.md](../grilling-borongan-2026-09-28.md)),
answered "ya semua": the recommendation stands as the decision.

Gerbang: tolak approve bila saldo provider tercatat < Campaign Balance yang
diminta, dengan opsi eksplisit Admin mencatat "sudah dicek, kurang" sebagai
keputusan tertunda — FFI-07 menyebutnya pengganti API saldo yang tak ada;
menjadikannya observasi menghapus satu-satunya kontrol yang PRD sediakan.
