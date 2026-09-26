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
// Fundraiser's honest withdrawal, the other a freeze over a problem. An
// unapproved Campaign is only ever shown to its Fundraiser, Verifiers and
// Admins (CONTEXT.md, Campaign Status), so its banner says it is not public.
const BANNER_COPY: Partial<Record<CampaignLifecycleStatus, string>> = {
  DRAFT: 'Campaign ini masih Draf: belum tampil untuk publik dan belum menerima donasi.',
  SUBMITTED: 'Campaign ini sedang menunggu keputusan Verifier: belum tampil untuk publik dan belum menerima donasi.',
  REJECTED: 'Campaign ini ditolak Verifier: belum tampil untuk publik dan tidak menerima donasi.',
  SUSPENDED: 'Campaign ini sedang ditinjau dan tidak menerima donasi.',
  CANCELLED: 'Fundraiser telah menarik Campaign ini.',
  EXPIRED: 'Campaign ini telah berakhir.',
  COMPLETED: 'Campaign ini telah berakhir.',
};

/** The banner sentence for a closed or unapproved Campaign, or null while Active. */
export function statusBannerCopy(status: CampaignLifecycleStatus | undefined): string | null {
  return (status && BANNER_COPY[status]) ?? null;
}
