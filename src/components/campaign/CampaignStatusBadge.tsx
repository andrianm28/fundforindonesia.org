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
 * What a badge reads, in Indonesian, for the Donors and Fundraisers who see
 * it. Badges only: refusals and notifications keep the glossary names in
 * STATUS_LABEL (CONTEXT.md, Campaign Status).
 */
const BADGE_LABEL: Record<CampaignLifecycleStatus, string> = {
  DRAFT: 'Draf',
  SUBMITTED: 'Diajukan',
  REJECTED: 'Perlu revisi',
  ACTIVE: 'Aktif',
  SUSPENDED: 'Ditangguhkan',
  CANCELLED: 'Ditarik',
  COMPLETED: 'Selesai',
  EXPIRED: 'Berakhir',
};

/**
 * The badge text for a status (PKS pasal 3.3). A Rejected Campaign reads
 * "Perlu revisi" while its Fundraiser may still resubmit it, and "Ditolak"
 * once the Verifier rejected it for good (`rejectionFinal`).
 */
export function campaignBadgeLabel(
  status: CampaignLifecycleStatus,
  options: { rejectionFinal?: boolean } = {}
): string {
  if (status === 'REJECTED' && options.rejectionFinal) return 'Ditolak';
  return BADGE_LABEL[status];
}

/**
 * A Campaign's status as a badge, in Indonesian. Pass the effective status,
 * so an Active Campaign past its deadline reads as Berakhir (Expired).
 */
export function CampaignStatusBadge({
  status,
  rejectionFinal = false,
}: {
  status: CampaignLifecycleStatus;
  rejectionFinal?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${TONE[status]}`}
    >
      {campaignBadgeLabel(status, { rejectionFinal })}
    </span>
  );
}
