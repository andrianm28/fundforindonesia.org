import { STATUS_LABEL } from '@/lib/campaign-status-label';
import type { CampaignLifecycleStatus } from '@/types/campaign';

const TONE: Record<CampaignLifecycleStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SUBMITTED: 'bg-yellow-100 text-yellow-800',
  REJECTED: 'bg-red-100 text-red-800',
  ACTIVE: 'bg-green-100 text-green-800',
  SUSPENDED: 'bg-orange-100 text-orange-800',
  CANCELLED: 'bg-gray-100 text-gray-700',
  COMPLETED: 'bg-blue-100 text-blue-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
};

/**
 * A Campaign's status as a badge, named as the glossary names it
 * (STATUS_LABEL). Pass the effective status, so an Active Campaign past its
 * deadline reads as Expired.
 */
export function CampaignStatusBadge({ status }: { status: CampaignLifecycleStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
