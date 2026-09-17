'use client';

import React from 'react';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import type { CampaignCardData } from '@/types/campaign';

export interface OngoingProgramsProps {
  campaigns: CampaignCardData[];
  isLoading?: boolean;
}

/**
 * OngoingPrograms — "Program Donasi Berkelanjutan" section.
 *
 * Displays ongoing donation programs using a compact-scroll
 * variant of CampaignGrid.
 *
 * Validates: Requirements 1.5
 */
export function OngoingPrograms({ campaigns, isLoading = false }: OngoingProgramsProps) {
  if (!isLoading && campaigns.length === 0) return null;

  return (
    <section className="py-6">
      <div className="px-4 mb-3">
        <h2 className="text-lg font-bold text-text">Program Donasi Berkelanjutan</h2>
        <p className="text-sm text-text-secondary mt-0.5">
          Donasi rutin untuk kebaikan yang berkelanjutan
        </p>
      </div>
      <div className="px-4">
        <CampaignGrid
          campaigns={campaigns}
          variant="compact-scroll"
          isLoading={isLoading}
          skeletonCount={3}
          emptyMessage="Belum ada program berkelanjutan"
        />
      </div>
    </section>
  );
}

export default OngoingPrograms;
