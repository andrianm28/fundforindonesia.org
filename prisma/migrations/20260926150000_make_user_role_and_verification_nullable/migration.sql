-- The Role hierarchy and the self-claimed verification are retired
-- (retire-role-hierarchy 02): no code reads or writes User "role",
-- "isVerified" or "verificationType"; authority comes only from
-- UserAssignment (ADR 0005). "verificationType" was already nullable with no
-- default. Additive: existing values stay, new users get NULL. The columns and
-- the Role enum are dropped by a later migration, once this code is live
-- (ticket 03).

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "isVerified" DROP NOT NULL,
ALTER COLUMN "isVerified" DROP DEFAULT,
ALTER COLUMN "role" DROP NOT NULL,
ALTER COLUMN "role" DROP DEFAULT;
