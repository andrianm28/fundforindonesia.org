# 16: Field-level encryption: migrate and contract

**What to build:** Every reader uses the protected form and the plaintext columns are gone, so a stolen database dump no longer hands over Donor contact details.

**Blocked by:** 15

**Status:** ready-for-agent

- [ ] All readers of email, phone and bank account use the new form
- [ ] Donor matching and lookup go through the HMAC, never through a decrypted scan
- [ ] Plaintext columns for email, phone and bank account number are dropped by migration
- [ ] Documented plainly: this protects against a dump and not against a rogue Admin reading the panel
