# 12: Where is a Bank Account number decrypted, and what is the payout instruction?

**Type:** grilling

**Status:** resolved

**Built by:** [89: M-a payout-reveal-account-number](89-payout-reveal-account-number.md) (membuka ulang premis tiket ini, lihat Comments)

## Question

[01: How does a Fundraiser get a bank account, and who says it is theirs?](01-bank-account-verification.md)
decided that a Bank Account is created by its owner, unverified, and verified by
a Verifier through a Verification Request. None of that is written yet. Reading
that decision against the code turned up the gap underneath it.

`readBankAccountNumber` in `src/lib/contact-fields.ts:188` has **no production
caller.** The schema says otherwise: the comment on
`accountNumberCiphertext` in `prisma/schema.prisma` states the number is
"decrypted at the point of payout, with masking at the UI." That does not happen
yet. The only query against a Bank Account anywhere in `src/` is
`src/lib/money/payouts.ts:148`, and it selects by id -- which is enough to
approve a Payout, because approval only checks ownership and `verifiedAt`, and
neither needs the number. So today no code has ever needed to read the plaintext
number, and the helper that would read it is dead.

The questions:

1. **What actually instructs the transfer?** ADR 0006 records that Sumopod has
   no disbursement API, so a Payout is withdrawn by hand in the provider's
   dashboard by an Admin. If that is still the case, the number never needs to
   reach the platform at payout time at all, and the schema comment is wrong.
   If a provider with a disbursement API is switched on, someone has to read it.
2. **Who may read it, and when?** ADR 0012 chose a randomized ciphertext over an
   HMAC, so a logged read cannot be searched afterwards. Reading it is therefore
   a one-way, unprovable event, and that is a real cost the design accepted.
3. **What is shown in the UI?** "Masking at the UI" is asserted but no mask is
   implemented either.
4. **Does the Verifier's check need the number?** A Verifier checks the name
   against a document. Whether they also see the number -- and can therefore
   notice a fat-fingered digit -- is a separate question from seeing the name.

## Notes

Surfaced 2026-09-27 by a verification pass over the factual claims in ADR 0018,
which read the code rather than the ticket. The claim it did **not** break was
the important one: there is no HMAC and no searchable field for the account
number, so the absence of a uniqueness guarantee is real and ADR 0012's decision
holds.

Related: ADR 0012 for the encryption scheme, and
[01: How does a Fundraiser get a bank account, and who says it is theirs?](01-bank-account-verification.md)
for who owns the account and who verifies it.

## Answer

Owner (Dri), 2026-09-28, in the batch grilling round
([grilling-borongan-2026-09-28.md](../grilling-borongan-2026-09-28.md)),
answered "ya semua": the recommendation stands as the decision.

Jawab (1) dulu: kalau provider aktif masih tanpa API pencairan, nyatakan
eksplisit nomor tak pernah dibaca di payout, perbaiki komentar schema, tutup
(2)-(3) sebagai "tidak berlaku sampai ada provider dengan API pencairan" —
keputusan satu kalimat, murah.

## Comments

- 2026-10-04: premis jawaban di atas dibuka ulang oleh [89](89-payout-reveal-account-number.md): transfer manual menuntut Admin mengetik nomor penuh, jadi "nomor tak pernah dibaca di payout" tidak berlaku. Menunggu C6.
