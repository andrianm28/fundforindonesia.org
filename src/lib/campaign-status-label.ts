import type { CampaignLifecycleStatus } from '@/types/campaign';

/**
 * The one name for each Campaign Status, as the glossary spells it
 * (CONTEXT.md), used as-is inside Indonesian sentences and on every status
 * badge. Kept free of server imports so browser code can show it too; the
 * lifecycle module re-exports it for its refusals and notifications.
 */
export const STATUS_LABEL: Record<CampaignLifecycleStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  REJECTED: 'Rejected',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
};
