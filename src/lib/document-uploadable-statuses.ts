import type { CampaignLifecycleStatus } from '@/types/campaign';

/**
 * The Campaign statuses a Fundraiser may still add a document in (ticket 64):
 * while it is being prepared, is with a Verifier, was sent back, or runs and
 * may ask for a change. A closed Campaign takes no new papers.
 *
 * Free of Prisma values, like PAYOUT_REQUESTABLE_STATUSES, so a screen can
 * offer the upload with the same list `uploadDocument` enforces.
 */
export const DOCUMENT_UPLOADABLE_STATUSES: readonly CampaignLifecycleStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'REJECTED',
  'ACTIVE',
];
