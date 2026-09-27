-- The contract step of ADR 0012 (prd-compliance 16): drop the plaintext
-- columns for email, phone and the bank account number, so a stolen database
-- dump no longer hands over a Donor address.
--
-- This is the step after the expand step (20260927010000_add_contact_field_
-- encryption and 20260928030000_protect_partnership_inquiry_contact), which
-- added the protected columns beside the plaintext and left them NULL on rows
-- written before FIELD_ENCRYPTION_KEY and FIELD_HMAC_KEY were configured.
--
-- THE BACKFILL MUST HAVE RUN FIRST. Every row whose plaintext is not null must
-- have its protected columns filled, or the value is about to be dropped with
-- nothing left to read it from. The guard below refuses the migration if that
-- is not true, so deploying early stops with a message naming what to do,
-- rather than losing contact details quietly. Backfill with:
--
--   npx tsx prisma/backfill-contact-fields.ts
--
-- It is safe to run more than once, and it reports what it filled.
--
-- Two things go with the plaintext, deliberately rather than by oversight:
--
--   - `@@unique([ownerId, bankCode, accountNumber])` cannot survive, because
--     the account number is a randomized ciphertext and two encryptions of one
--     number never match, so the constraint could never fire again. A
--     database-level guarantee here would need a keyed lookup for the account
--     number, which ADR 0012 deliberately does not have: it is never searched.
--     So a bank account number carries NO uniqueness guarantee after this
--     migration: nothing in the database refuses a duplicate, and nothing in
--     the application checks for one either. A duplicate payout destination is
--     therefore possible, and CONTEXT.md records that under Bank Account.
--   - `User.email @unique` moves to the searchable lookup HMAC, which is
--     computed from the lowercased address. That closes a gap the plaintext
--     unique had: it was case-sensitive, so one person could hold `Andi@x.id`
--     and `andi@x.id` as two accounts, and those two collide on the HMAC.

-- The guard. One DO block, raised before anything is dropped, so a backfill
-- that has not run, or one that was interrupted by a key change, stops here
-- with the plaintext exactly where it was. It comes first because that ordering
-- is the safety: nothing before it touches a column. (Prisma does run a
-- migration in a transaction, but nothing here depends on that.) Each check
-- names the rows it is about, so the message says what to fix.
DO $$
DECLARE
  leftover text;
  rotated text;
  colliding text;
BEGIN
  SELECT string_agg(model || '.' || field_name, ', ') INTO leftover FROM (
    SELECT 'User' AS model, 'email' AS field_name
      WHERE EXISTS (SELECT 1 FROM "User" WHERE "email" IS NOT NULL AND "emailCiphertext" IS NULL)
    UNION ALL
    SELECT 'User', 'phone'
      WHERE EXISTS (SELECT 1 FROM "User" WHERE "phone" IS NOT NULL AND "phoneCiphertext" IS NULL)
    UNION ALL
    SELECT 'BankAccount', 'accountNumber'
      WHERE EXISTS (SELECT 1 FROM "BankAccount" WHERE "accountNumber" IS NOT NULL AND "accountNumberCiphertext" IS NULL)
    UNION ALL
    SELECT 'Donation', 'guestEmail'
      WHERE EXISTS (SELECT 1 FROM "Donation" WHERE "guestEmail" IS NOT NULL AND "guestEmailCiphertext" IS NULL)
    UNION ALL
    SELECT 'Donation', 'guestPhone'
      WHERE EXISTS (SELECT 1 FROM "Donation" WHERE "guestPhone" IS NOT NULL AND "guestPhoneCiphertext" IS NULL)
    UNION ALL
    SELECT 'PartnershipInquiry', 'contactEmail'
      WHERE EXISTS (SELECT 1 FROM "PartnershipInquiry" WHERE "contactEmail" IS NOT NULL AND "contactEmailCiphertext" IS NULL)
    UNION ALL
    SELECT 'PartnershipInquiry', 'contactPhone'
      WHERE EXISTS (SELECT 1 FROM "PartnershipInquiry" WHERE "contactPhone" IS NOT NULL AND "contactPhoneCiphertext" IS NULL)
  ) pending;

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to drop the contact plaintext columns: % still has a value with nothing sealed for it. Run the backfill first (npx tsx prisma/backfill-contact-fields.ts) and deploy again. Nothing has been changed.', leftover;
  END IF;

  -- A key that changed between two runs of the backfill. The backfill seals each
  -- row under whatever FIELD_ENCRYPTION_KEY_ID (or FIELD_HMAC_KEY_ID) the
  -- deployment has at the moment it runs, and it deliberately skips rows that are
  -- sealed already, so a rotation halfway through leaves one table holding rows
  -- under two ids. `decrypt` refuses a key id it has no key for -- there is no
  -- keyring yet (ADR 0012, Consequences) -- so those contact details would be in
  -- the database and unreadable, and the plaintext this migration is about to
  -- drop is the only copy left to re-seal them from. The check above cannot see
  -- it: those rows are sealed, not NULL. So the drop refuses while any field is
  -- sealed under more than one key, and names the rows by key id, because
  -- "re-seal these" is only actionable if the owner is told which ones.
  WITH sealed AS (
    SELECT 'User.email' AS field, "emailKeyId" AS key_id, "id" AS row_id
      FROM "User" WHERE "emailKeyId" IS NOT NULL
    UNION ALL SELECT 'User.email (the lookup accounts are found by)', "emailHmacKeyId", "id"
      FROM "User" WHERE "emailHmacKeyId" IS NOT NULL
    UNION ALL SELECT 'User.phone', "phoneKeyId", "id"
      FROM "User" WHERE "phoneKeyId" IS NOT NULL
    UNION ALL SELECT 'BankAccount.accountNumber', "accountNumberKeyId", "id"
      FROM "BankAccount" WHERE "accountNumberKeyId" IS NOT NULL
    UNION ALL SELECT 'Donation.guestEmail', "guestEmailKeyId", "id"
      FROM "Donation" WHERE "guestEmailKeyId" IS NOT NULL
    UNION ALL SELECT 'Donation.guestEmail (the lookup receipts are found by)', "guestEmailHmacKeyId", "id"
      FROM "Donation" WHERE "guestEmailHmacKeyId" IS NOT NULL
    UNION ALL SELECT 'Donation.guestPhone', "guestPhoneKeyId", "id"
      FROM "Donation" WHERE "guestPhoneKeyId" IS NOT NULL
    UNION ALL SELECT 'PartnershipInquiry.contactEmail', "contactEmailKeyId", "id"
      FROM "PartnershipInquiry" WHERE "contactEmailKeyId" IS NOT NULL
    UNION ALL SELECT 'PartnershipInquiry.contactEmail (the lookup inquiries are found by)', "contactEmailHmacKeyId", "id"
      FROM "PartnershipInquiry" WHERE "contactEmailHmacKeyId" IS NOT NULL
    UNION ALL SELECT 'PartnershipInquiry.contactPhone', "contactPhoneKeyId", "id"
      FROM "PartnershipInquiry" WHERE "contactPhoneKeyId" IS NOT NULL
  ),
  per_key AS (
    SELECT field, key_id, string_agg('"' || row_id || '"', ', ' ORDER BY row_id) AS row_ids
      FROM sealed GROUP BY field, key_id
  ),
  per_field AS (
    -- One row per field that carries more than one key, which is the whole
    -- condition: count(DISTINCT key_id) > 1, counted after the grouping.
    SELECT field,
           count(*)::text AS key_count,
           string_agg(key_id || ' on ' || row_ids, ', ' ORDER BY key_id) AS keys
      FROM per_key GROUP BY field HAVING count(*) > 1
  )
  SELECT string_agg(field || ' is sealed under ' || key_count || ' keys: ' || keys, '; ')
    INTO rotated
    FROM per_field;

  IF rotated IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to drop the contact plaintext columns: % -- a key changed between two runs of the backfill, and there is no keyring to read the older rows with (ADR 0012). While the plaintext is still in place, clear the sealed columns on those rows and run the backfill again under a single key id. Nothing has been changed.', rotated;
  END IF;

  -- The new unique on the lookup HMAC. Two accounts whose addresses differ only
  -- in case are legitimate under the old case-sensitive unique and collide here,
  -- so this has to be a refusal with a row list rather than a constraint that
  -- fails at CREATE INDEX time with a constraint name and no explanation. Which
  -- of the two to keep is a decision about whose giving history it is, so it is
  -- the owner's and not the migration's.
  SELECT string_agg(t.hmac || ' (' || t.row_ids || ')', ', ') INTO colliding
    FROM (
      SELECT "emailHmac" AS hmac,
             string_agg('"' || "id" || '"', ', ' ORDER BY "id") AS row_ids
        FROM "User" WHERE "emailHmac" IS NOT NULL
        GROUP BY "emailHmac" HAVING count(*) > 1
    ) t;

  IF colliding IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to make emailHmac unique: % have more than one account for the same address once case is ignored. Merge them or correct the address, then deploy again. Nothing has been changed.', colliding;
  END IF;
END $$;

-- The protected columns become NOT NULL. The guard has just proved that no row
-- carries a plaintext without a sealed form, so nothing is left NULL that should
-- not be. This is what makes a future write that forgets to seal a value fail at
-- the database, rather than store a row nobody can read back.
ALTER TABLE "User" ALTER COLUMN "emailHmac" SET NOT NULL,
ALTER COLUMN "emailHmacKeyId" SET NOT NULL,
ALTER COLUMN "emailCiphertext" SET NOT NULL,
ALTER COLUMN "emailKeyId" SET NOT NULL;
ALTER TABLE "BankAccount" ALTER COLUMN "accountNumberCiphertext" SET NOT NULL,
ALTER COLUMN "accountNumberKeyId" SET NOT NULL;
ALTER TABLE "PartnershipInquiry" ALTER COLUMN "contactEmailHmac" SET NOT NULL,
ALTER COLUMN "contactEmailHmacKeyId" SET NOT NULL,
ALTER COLUMN "contactEmailCiphertext" SET NOT NULL,
ALTER COLUMN "contactEmailKeyId" SET NOT NULL;

-- Uniqueness on the lookup, built before the drop while the old indexes still
-- exist, so this is an index build and not a table rewrite. The plain
-- `User_emailHmac_idx` from the expand step goes with it: a unique index is
-- already a lookup index on that column, and Prisma would otherwise see two
-- indexes on one column where the schema declares one.
DROP INDEX "BankAccount_ownerId_bankCode_accountNumber_key";
CREATE UNIQUE INDEX "User_emailHmac_key" ON "User"("emailHmac");
DROP INDEX "User_emailHmac_idx";

-- DropIndex, then DropColumn: the last copy of a Donor's contact details in the
-- clear leaves the database here.
DROP INDEX "User_email_key";
DROP INDEX "User_email_idx";
ALTER TABLE "User" DROP COLUMN "email",
DROP COLUMN "phone";
ALTER TABLE "BankAccount" DROP COLUMN "accountNumber";
ALTER TABLE "Donation" DROP COLUMN "guestEmail",
DROP COLUMN "guestPhone";
ALTER TABLE "PartnershipInquiry" DROP COLUMN "contactEmail",
DROP COLUMN "contactPhone";
