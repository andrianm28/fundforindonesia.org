'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCampaigns } from '@/lib/hooks/useCampaigns';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import type { CampaignCardData } from '@/types/campaign';

export default function ExploreAllPage() {
  const [page, setPage] = useState(1);
  const [allCampaigns, setAllCampaigns] = useState<CampaignCardData[]>([]);

  const { campaigns, totalPages, isLoading } = useCampaigns({ page, limit: 12 });

  // Accumulate campaigns across pages
  useEffect(() => {
    if (campaigns.length > 0) {
      setAllCampaigns((prev) => {
        // Avoid duplicates by checking IDs
        const existingIds = new Set(prev.map((c) => c.id));
        const newCampaigns: CampaignCardData[] = campaigns
          .filter((c) => !existingIds.has(c.id))
          .map((c) => ({
            id: c.id,
            slug: c.slug,
            title: c.title,
            coverImage: c.coverImage,
            collectedAmount: c.collectedAmount,
            targetAmount: c.targetAmount,
            category: c.category,
            deadline: c.deadline ? new Date(c.deadline) : null,
            isUrgent: c.isUrgent,
            isDemo: c.isDemo,
            creator: {
              name: c.creator.name,
            },
          }));
        return [...prev, ...newCampaigns];
      });
    }
  }, [campaigns]);

  const handleLoadMore = useCallback(() => {
    if (!isLoading && page < totalPages) {
      setPage((p) => p + 1);
    }
  }, [isLoading, page, totalPages]);

  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-bold text-text mb-4">Semua Campaign</h1>
      <CampaignGrid
        campaigns={allCampaigns}
        variant="standard"
        isLoading={isLoading}
        hasMore={page < totalPages}
        onLoadMore={handleLoadMore}
        emptyMessage="Belum ada campaign yang tersedia"
        skeletonCount={6}
      />
    </div>
  );
}
