'use client';

import React from 'react';
import Link from 'next/link';
import { CampaignCard } from '@/components/campaign/CampaignCard';
import { CampaignCardSkeleton } from '@/components/campaign/CampaignCardSkeleton';
import type { CampaignCardData } from '@/types/campaign';

export interface FeaturedCampaignsProps {
  campaigns: CampaignCardData[];
  isLoading?: boolean;
}

/**
 * FeaturedCampaigns — "Pilihan Kitabisa" section.
 *
 * Displays up to 12 campaigns in a responsive grid with a
 * "Lihat semua" link to the explore page.
 *
 * Responsive: 2 columns mobile, 3 columns desktop.
 *
 * Validates: Requirements 1.6
 */
export function FeaturedCampaigns({ campaigns, isLoading = false }: FeaturedCampaignsProps) {
  const displayCampaigns = campaigns.slice(0, 12);

  if (isLoading && campaigns.length === 0) {
    return (
      <section className="py-6 px-4">
        <div className="flex items-center justify-between mb-3">
          <div className="h-5 w-36 bg-bg-secondary rounded animate-pulse" />
          <div className="h-4 w-20 bg-bg-secondary rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <CampaignCardSkeleton key={`featured-skel-${i}`} variant="standard" />
          ))}
        </div>
      </section>
    );
  }

  if (displayCampaigns.length === 0) return null;

  return (
    <section className="py-6 px-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-text">Pilihan Kami</h2>
        <Link
          href="/explore/all"
          className="text-sm font-medium text-primary hover:text-primary-dark transition-colors"
        >
          Lihat semua
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {displayCampaigns.map((campaign) => (
          <CampaignCard
            key={campaign.id}
            campaign={{
              ...campaign,
              deadline: campaign.deadline ? campaign.deadline.toString() : null,
            }}
            variant="standard"
          />
        ))}
      </div>
    </section>
  );
}

export default FeaturedCampaigns;
