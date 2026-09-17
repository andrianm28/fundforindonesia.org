-- Data Migration: Upgrade verified users to CAMPAIGN_CREATOR role
-- Unverified users remain as DONOR (the default)
UPDATE "User" SET "role" = 'CAMPAIGN_CREATOR' WHERE "isVerified" = true;
