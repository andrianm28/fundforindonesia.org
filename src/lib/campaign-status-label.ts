import type { CampaignLifecycleStatus } from '@/types/campaign';

/**
 * The one name for each Campaign Status, as the glossary spells it
 * (CONTEXT.md), used as-is inside Indonesian sentences: refusals,
 * notifications, status-change reasons. Status badges show their own
 * Indonesian labels instead (CampaignStatusBadge). Kept free of server
 * imports so browser code can use it too; the lifecycle module re-exports it.
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
