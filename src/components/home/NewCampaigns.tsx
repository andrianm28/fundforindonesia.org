'use client';

import React from 'react';
import { CampaignCard } from '@/components/campaign/CampaignCard';
import { CampaignCardSkeleton } from '@/components/campaign/CampaignCardSkeleton';
import type { CampaignCardData } from '@/types/campaign';

export interface NewCampaignsProps {
  campaigns: CampaignCardData[];
  isLoading?: boolean;
}

/**
 * NewCampaigns — "Yang Baru" section.
 *
 * Displays a horizontally scrollable list of new campaigns
 * using compact CampaignCard variant.
 *
 * Validates: Requirements 1.4
 */
export function NewCampaigns({ campaigns, isLoading = false }: NewCampaignsProps) {
  if (isLoading && campaigns.length === 0) {
    return (
      <section className="py-6">
        <div className="px-4 mb-3">
          <div className="h-5 w-48 bg-bg-secondary rounded animate-pulse" />
        </div>
        <div className="px-4">
          <CampaignCardSkeleton variant="compact" count={3} />
        </div>
      </section>
    );
  }

  if (campaigns.length === 0) return null;

  return (
    <section className="py-6">
      <div className="px-4 mb-3">
        <h2 className="text-lg font-bold text-text">Yang Baru</h2>
      </div>
      <div className="flex gap-4 overflow-x-auto px-4 pb-2 scrollbar-hide">
        {campaigns.map((campaign) => (
          <CampaignCard
            key={campaign.id}
            campaign={{
              ...campaign,
              deadline: campaign.deadline ? campaign.deadline.toString() : null,
            }}
            variant="compact"
          />
        ))}
      </div>
    </section>
  );
}

export default NewCampaigns;
