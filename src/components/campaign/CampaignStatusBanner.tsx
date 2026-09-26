'use client';

import React from 'react';
import type { CampaignLifecycleStatus } from '@/types/campaign';
import { statusBannerCopy } from '@/lib/campaign-page-status';

interface CampaignStatusBannerProps {
  status: CampaignLifecycleStatus;
  /** Shown under the banner; only the owning Fundraiser ever has one. */
  suspensionReason?: string | null;
}

/** A neutral banner for a closed or unapproved Campaign; nothing while Active. */
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
