-- A Fundraiser withdrawing an undecided Verification Request
-- (verification-request 03) is logged as its own status-change action, so
-- the Campaign's history tells a withdrawal apart from a Verifier's refusal.
-- Additive.

-- AlterEnum
ALTER TYPE "CampaignStatusChangeAction" ADD VALUE 'SUBMISSION_WITHDRAWN';
