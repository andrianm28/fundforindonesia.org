'use client';

import { useState, useCallback } from 'react';
import { useCampaigns } from '@/lib/hooks/useCampaigns';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import type { CampaignCardData } from '@/types/campaign';
import { KIND_LABEL, KINDS, type CampaignKind } from '@/lib/campaign-kind';

export default function ExploreAllPage() {
  const [page, setPage] = useState(1);
  const [allCampaigns, setAllCampaigns] = useState<CampaignCardData[]>([]);
  // The catalogue's Kind filter; null lists every Kind.
  const [kind, setKind] = useState<CampaignKind | null>(null);

  const { campaigns, totalPages, isLoading } = useCampaigns({ page, limit: 12, kind: kind ?? undefined });

  const chooseKind = useCallback((next: CampaignKind | null) => {
    setKind(next);
    setPage(1);
    setAllCampaigns([]);
  }, []);

  // Accumulate campaigns across pages: when a new page of results arrives
  // (adjusting state during render, keyed on the result list's identity),
  // fold it into what is already shown.
  const [foldedCampaigns, setFoldedCampaigns] = useState<typeof campaigns | null>(null);
  if (campaigns.length > 0 && campaigns !== foldedCampaigns) {
    setFoldedCampaigns(campaigns);
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

  const handleLoadMore = useCallback(() => {
    if (!isLoading && page < totalPages) {
      setPage((p) => p + 1);
    }
  }, [isLoading, page, totalPages]);

  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-bold text-text mb-4">Semua Campaign</h1>
      <div className="flex gap-2 overflow-x-auto mb-4" role="group" aria-label="Filter Kind">
        {[null, ...KINDS].map((option) => {
          const selected = option === kind;
          return (
            <button
              key={option ?? 'ALL'}
              type="button"
              aria-pressed={selected}
              onClick={() => chooseKind(option)}
              className={`shrink-0 px-3 py-1.5 text-sm rounded-full border transition-colors ${
                selected
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-text border-border hover:border-primary'
              }`}
            >
              {option ? KIND_LABEL[option] : 'Semua'}
            </button>
          );
        })}
      </div>
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
