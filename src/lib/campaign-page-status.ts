import type { CampaignLifecycleStatus } from '@/types/campaign';

/**
 * Whether a page may offer donating. Only an effectively Active Campaign
 * accepts a Donation; POST /api/donations enforces the same rule, this just
 * keeps a page from inviting a donation the server will refuse. A missing
 * status counts as not Active.
 */
export function offersDonating(status: CampaignLifecycleStatus | undefined): boolean {
  return status === 'ACTIVE';
}

// A Cancelled Campaign must never read as Suspended (PRD §8): one is a
// Fundraiser's honest withdrawal, the other a freeze over a problem.
const BANNER_COPY: Partial<Record<CampaignLifecycleStatus, string>> = {
  SUSPENDED: 'Campaign ini sedang ditinjau dan tidak menerima donasi.',
  CANCELLED: 'Fundraiser telah menarik Campaign ini.',
  EXPIRED: 'Campaign ini telah berakhir.',
  COMPLETED: 'Campaign ini telah berakhir.',
};

/** The banner sentence for a closed Campaign, or null for any other status. */
export function statusBannerCopy(status: CampaignLifecycleStatus | undefined): string | null {
  return (status && BANNER_COPY[status]) ?? null;
}
