-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- Task M9: mark the campaigns that predate the money layer as demo content.
--
-- The owner has ruled that this data stays -- marked rather than deleted --
-- because it is sample content, not real money owed to anyone. The predicate
-- below is written, not a pasted list of ids: it selects every campaign that
-- exists AT MIGRATION TIME with no Payment row behind ANY of its donations.
-- A Payment is only ever created by the money layer (src/app/api/donations/
-- route.ts), so "zero Payments across all of this campaign's donations" is
-- exactly "predates the money layer" -- including a campaign with zero
-- donations at all, which trivially has zero Payments too and is equally
-- fixture content.
--
-- This runs once, against the rows that exist right now. A campaign created
-- after this migration is not touched by it -- Campaign.isDemo defaults to
-- false, and nothing in the application ever sets it true.
UPDATE "Campaign" c
SET "isDemo" = true
WHERE NOT EXISTS (
  SELECT 1
  FROM "Donation" d
  JOIN "Payment" p ON p."donationId" = d.id
  WHERE d."campaignId" = c.id
);
