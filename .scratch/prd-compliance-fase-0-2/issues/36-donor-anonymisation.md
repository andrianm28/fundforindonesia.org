# 36: Donor anonymisation

**What to build:** A Donor can have their identity removed without the platform losing its accounting.

**Blocked by:** 16

**Status:** awaiting-merge

- [x] Name, email and phone are anonymised on request, including the HMAC and ciphertext
- [x] Amounts and ledger entries are untouched
- [x] A Guest Donor requests it from a link in their Receipt; a registered user from account settings
- [x] An anonymised Donation can no longer be refunded through the system, and says so

## Comments

- 2026-10-02, builder (branch `claude/prd-36-donor-anonymisation`):

  What it does and where: `src/lib/donor-anonymisation.ts` (module),
  `POST /api/receipts/[token]/anonymise` (Guest Donor, link on the Receipt
  page), `POST /api/user/anonymise-donations` (registered, account settings).
  Migration `20261002120000_donation_anonymised_at` adds `Donation.anonymisedAt`.
  Removed vs kept is written in CONTEXT.md under "Anonimisasi Donor".

  Decisions taken without an owner ruling (flagged in the hand-off):

  1. Registered Donor: the Donations are unlinked (`donorId` null) and the
     account (User row, its name/email/phone) is NOT erased.
  2. A request is refused (409) while a Refund on those Donations is not
     COMPLETED/REJECTED/FAILED; it can be asked again afterwards.
  3. A finished Refund's recorded destination (`donorAccountName`, sealed
     number, bank code) is kept, as proof of where money went.
  4. `Donation.message` and Prayer text are kept (not name/email/phone).
  5. Guest scope is every Guest Donation with the same email HMAC.

- 2026-10-02: awaiting-merge. PR #172, commit 0fe8a2f. Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.
