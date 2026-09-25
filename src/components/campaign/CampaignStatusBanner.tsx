'use client';

import React, { useEffect, useState } from 'react';
import type { CampaignLifecycleStatus } from '@/types/campaign';

export type { CampaignLifecycleStatus };

/**
 * Whether the page may offer donating. Only an effectively Active Campaign
 * accepts a Donation; POST /api/donations enforces the same rule, this just
 * keeps the page from inviting a donation the server will refuse.
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

interface CampaignStatusBannerProps {
  status: CampaignLifecycleStatus;
  /** Shown under the banner; only the owning Fundraiser ever has one. */
  suspensionReason?: string | null;
}

/** The banner sentence for a closed Campaign, or null for any other status. */
export function statusBannerCopy(status: CampaignLifecycleStatus | undefined): string | null {
  return (status && BANNER_COPY[status]) ?? null;
}

/** A neutral banner for a closed Campaign; nothing for any other status. */
export function CampaignStatusBanner({ status, suspensionReason }: CampaignStatusBannerProps) {
  const copy = statusBannerCopy(status);
  if (!copy) return null;

  return (
    <div
      role="status"
      aria-label="Status Campaign"
      className="bg-gray-100 border border-border text-text text-sm rounded-lg px-3 py-2 mb-3"
    >
      <p>{copy}</p>
      {status === 'SUSPENDED' && suspensionReason && (
        <p className="mt-1 text-text-secondary">Alasan: {suspensionReason}</p>
      )}
    </div>
  );
}

/**
 * The Suspension reason for the signed-in viewer, asked of the API only
 * while the Campaign is Suspended. The Campaign page is cached for every
 * visitor alike, so the reason cannot be part of it; the API returns it to
 * the owning Fundraiser's session alone and leaves it out for anyone else.
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
