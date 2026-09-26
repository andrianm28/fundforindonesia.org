# 15: Field-level encryption: expand

**What to build:** Donor and Fundraiser contact details gain their protected representations alongside the plaintext, so readers can migrate without a flag day.

**Blocked by:** None (can start immediately)

**Status:** done (PR #25, 840f7cd)

- [ ] Email gains a deterministic keyed HMAC in a searchable column plus a randomized ciphertext
- [ ] Phone and bank account number gain randomized authenticated encryption
- [ ] Name stays plaintext by decision, not by omission
- [ ] Each encrypted field carries a key id so rotation is possible later
- [ ] The HMAC key and the encryption key are separate secrets
- [ ] Writes populate both old and new forms; implements ADR 0012

- 2026-09-26 (after merge), follow-ups for the contract step (from the agent):
  1. Backfill every row whose new columns are NULL.
  2. Move readers to `emailHmac` and decryption.
  3. Drop the plaintext columns and replace `User.email @unique` and `@@unique([ownerId, bankCode, accountNumber])`. Decide whether `emailHmac` becomes unique, since case-differing emails collide.
  4. Add a keyring before the first key rotation.
  5. Anonymising a Donor clears the plaintext, the ciphertext and the HMAC together.
  - Open: nested writes (such as `bankAccounts: { create }`) skip encryption, with no guard. Guest Donor contact fields must be added to `field-protection.ts` when they are created.
