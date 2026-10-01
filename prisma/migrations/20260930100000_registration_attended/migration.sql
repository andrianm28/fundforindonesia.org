-- Ticket 35: the Fundraiser marks who attended when completing a Volunteer
-- Batch; only an attended CONFIRMED Registration earns a Sertifikat
-- Keikutsertaan. NOT NULL DEFAULT false is safe on a table that already holds
-- rows: Postgres fills every existing Registration with false, which is true
-- of all of them (no Batch has been completed with attendance yet).

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN "attended" BOOLEAN NOT NULL DEFAULT false;
