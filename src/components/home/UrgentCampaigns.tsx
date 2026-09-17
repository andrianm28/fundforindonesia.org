'use client';

import React from 'react';
import { CampaignCard } from '@/components/campaign/CampaignCard';
import { CampaignCardSkeleton } from '@/components/campaign/CampaignCardSkeleton';
export interface UrgentCampaignItem {
  id: string;
  slug: string;
  title: string;
  coverImage: string;
  collectedAmount: number;
  targetAmount: number;
  category: string;
  deadline: string | Date | null;
  isUrgent: boolean;
  isDemo?: boolean;
  creator: {
    name: string;
    isVerified: boolean;
    verificationType: string | null;
  };
}

export interface UrgentCampaignsProps {
  campaigns: UrgentCampaignItem[];
  isLoading: boolean;
}

/**
 * UrgentCampaigns displays a horizontally scrollable list of urgent campaign cards.
 * Shows campaigns marked with isUrgent=true in a compact card variant.
 *
 * Section header: "Penggalangan Dana Mendesak" with a red "DARURAT" badge.
 * Shows CampaignCardSkeleton during loading state.
 */
export function UrgentCampaigns({ campaigns, isLoading }: UrgentCampaignsProps) {
  return (
    <section className="py-6" aria-label="Penggalangan Dana Mendesak">
      {/* Section Header */}
      <div className="flex items-center gap-2 mb-4 px-4">
        <h2 className="text-lg font-bold text-text">Penggalangan Dana Mendesak</h2>
        <span className="bg-danger text-white text-[10px] font-bold px-2 py-0.5 rounded">
          DARURAT
        </span>
      </div>

      {/* Horizontal Scroll Container */}
      <div className="overflow-x-auto scrollbar-hide px-4">
        <div className="flex gap-4">
          {isLoading ? (
            <CampaignCardSkeleton variant="compact" count={3} />
          ) : (
            campaigns.map((campaign) => {
              const deadlineStr = campaign.deadline
                ? typeof campaign.deadline === 'string'
                  ? campaign.deadline
                  : campaign.deadline.toISOString()
                : null;

              return (
                <CampaignCard
                  key={campaign.id}
                  campaign={{
                    ...campaign,
                    deadline: deadlineStr,
                  }}
                  variant="compact"
                />
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

export default UrgentCampaigns;
