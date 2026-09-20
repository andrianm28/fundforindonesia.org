---
status: accepted
---

# Searchable HMAC for email, randomized encryption for phone and bank account, plaintext name

The PRD asks for email, phone, name, and bank account encrypted at column level. Read literally that breaks three things the same document specifies: matching repeat Donors by email, letting a Guest Donor claim their history by email, and checking a Refund's Bank Account holder against the name on the Donation. So we name the scheme per field instead of per table. Email is stored twice, as a deterministic keyed HMAC-SHA256 in a searchable column and as a randomized ciphertext for sending and display. Phone and bank account number are randomized authenticated encryption and are never searched. Name stays plaintext, because it is already shown publicly unless the Donation is anonymous and because Refund has to compare it.

## Considered options

- Randomized encryption on all four columns, as the PRD's wording implies. Rejected: it makes the repeat-donor metric, the Guest Donor history claim, and the Refund name check impossible to implement.
- Deterministic encryption on all four. Rejected: a stolen dump still reveals which rows share a value, so determinism costs privacy on fields that are never searched and buys nothing back.
- Disk encryption only. Rejected: the threat this is aimed at is a database dump, which disk encryption does not survive once the disk is mounted.

## Consequences

- Two secrets, not one. The HMAC key and the encryption key are separate: losing the HMAC key costs matching, losing the encryption key costs the data. Both need a key id column so rotation is possible without a flag day.
- Anonymising a Donor under FFI-16 clears the plaintext, the ciphertext, and the HMAC, and leaves the ledger untouched. A Donation that has been anonymised can no longer be refunded through the system, which the Refund design already states.
- This scheme defends against a stolen dump and nothing else. It does not stop an Admin with panel access from reading a Donor's details; that needs an access log on the panel, which does not exist today and is separate work.
