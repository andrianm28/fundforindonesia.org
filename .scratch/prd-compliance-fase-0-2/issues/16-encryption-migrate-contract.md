# 16: Field-level encryption: migrate and contract

**What to build:** Every reader uses the protected form and the plaintext columns are gone, so a stolen database dump no longer hands over Donor contact details.

**Blocked by:** 15

**Status:** done (PR #89, 8b266b2)

- [x] All readers of email, phone and bank account use the new form
- [x] Donor matching and lookup go through the HMAC, never through a decrypted scan
- [x] Plaintext columns for email, phone and bank account number are dropped by migration
- [x] Documented plainly: this protects against a dump and not against a rogue Admin reading the panel

## Comments

- 2026-09-27, for the owner, before deploying this release:

  1. **Run the backfill once, by hand, before the deploy.** Rows written before
     `FIELD_ENCRYPTION_KEY` and `FIELD_HMAC_KEY` existed have NULL in the
     protected columns, and the migration refuses to run while any such row
     exists -- it names the columns and the command and changes nothing. So:

     ```
     npx tsx prisma/backfill-contact-fields.ts
     ```

     Safe to run more than once and safe to stop and re-run; it commits per row
     and reports what it filled. `ops/deploy.sh` documents this at the migrate
     step and deliberately does NOT run it: the migration's own refusal is the
     guarantee, and a deploy that runs the backfill itself would take it away.
     A deploy that skipped the backfill stops with the old app still serving
     and nothing lost.

  2. **The keys are no longer optional.** With the plaintext columns gone there
     is no fallback, so a deployment without all four `FIELD_*` variables
     cannot write a contact detail at all and is refused at the first one
     rather than storing something it cannot read back. `.env.example`,
     `docker-compose.yml`, `docker-compose.prod.yml` and the e2e CI job all say
     so now.

  3. **One database constraint is gone and should be a decision, not a
     surprise.** `@@unique([ownerId, bankCode, accountNumber])` cannot survive:
     the account number is a randomized ciphertext and two encryptions of one
     number never match, so the constraint could never fire again. Putting it
     back at the database level needs a keyed lookup for the account number,
     which ADR 0012 deliberately does not have. A duplicate destination is now
     refused by the application.

  4. **`User.email @unique` moved to `emailHmac @unique`, and case now
     counts as the same address.** The old unique was case-sensitive, so one
     person could hold `Andi@x.id` and `andi@x.id` as two accounts; the lookup
     HMAC is computed from the lowercased address, so those collide. If
     production holds such a pair the migration refuses and lists the row ids --
     which account to keep is a decision about whose giving history it is, so it
     is the owner's and not the migration's.

- 2026-09-27, the Admin user search changed shape and should be said out loud:
  it used to be `email contains`, which on a ciphertext would have matched
  nothing useful. An address an Admin types now finds that one account exactly;
  anything else searches names. A partial-address search is no longer possible
  and cannot be without decrypting every account.

- 2026-09-27, follow-ups from ticket 15 that this ticket does not close:
  - the keyring before the first key rotation (15's item 4) -- no rotation
    exists yet, and both key-id columns are in place for it;
  - anonymising a Donor must clear the plaintext, the ciphertext and the HMAC
    together (15's item 5) -- that is ticket 36, and there is no anonymisation
    code to change yet.
