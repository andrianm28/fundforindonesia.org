-- Ticket 38: an Admin suspends a Volunteer Trip and lifts the Suspension.
-- Each change is logged in VolunteerTripStatusChange under its own action,
-- as CampaignStatusChangeAction does for a Campaign. Additive: two enum
-- values, no table or column change, no backfill.

-- AlterEnum
ALTER TYPE "VolunteerTripStatusChangeAction" ADD VALUE 'SUSPENDED';
ALTER TYPE "VolunteerTripStatusChangeAction" ADD VALUE 'SUSPENSION_LIFTED';
