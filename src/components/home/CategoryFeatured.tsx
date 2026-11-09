import React from 'react';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import type { CampaignCardData } from '@/types/campaign';

export interface CategoryFeaturedGroup {
  slug: string;
  name: string;
  campaigns: CampaignCardData[];
}

/**
 * "Unggulan kategori" on the home page (PKS pemenuhan 15): one section per
 * Category that has Campaigns an Admin marked, in the Admin's order. Only
 * publicly visible Campaigns reach here; a Category with none has no section.
 */
export function CategoryFeatured({ groups }: { groups: CategoryFeaturedGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.slug} className="px-4 py-4" aria-label={`Unggulan ${group.name}`}>
          <h2 className="text-lg font-bold text-text mb-3">Unggulan {group.name}</h2>
          <CampaignGrid campaigns={group.campaigns} variant="compact-scroll" emptyMessage="" />
        </section>
      ))}
    </>
  );
}
