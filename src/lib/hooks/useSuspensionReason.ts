import { useEffect, useState } from 'react';
import type { CampaignLifecycleStatus } from '@/types/campaign';

/**
 * The Suspension reason for the signed-in viewer, asked of the API only
 * while the Campaign is Suspended. The Campaign page is cached for every
 * visitor alike, so the reason cannot be part of it; GET
 * /api/campaigns/[slug] returns it to the owning Fundraiser's session alone
 * and leaves it out for anyone else.
 */
export function useSuspensionReason(
  slug: string,
  status: CampaignLifecycleStatus
): string | null {
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'SUSPENDED') return;
    let cancelled = false;
    fetch(`/api/campaigns/${slug}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const value = data?.campaign?.suspensionReason;
        if (!cancelled && typeof value === 'string') setReason(value);
      })
      .catch(() => {
        // No reason shown; the banner itself still stands.
      });
    return () => {
      cancelled = true;
    };
  }, [slug, status]);

  return reason;
}
