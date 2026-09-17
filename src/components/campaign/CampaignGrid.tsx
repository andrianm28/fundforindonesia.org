'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { CampaignCard } from './CampaignCard';
import { CampaignCardSkeleton } from './CampaignCardSkeleton';
import type { CampaignCardData } from '@/types/campaign';

export interface CampaignGridProps {
  campaigns: CampaignCardData[];
  variant: 'standard' | 'compact-scroll';
  isLoading?: boolean;
  skeletonCount?: number;
  emptyMessage?: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

/**
 * CampaignGrid displays a responsive grid or horizontal scroll of campaign cards.
 *
 * Features:
 * - Standard variant: responsive grid (1col mobile, 2col tablet, 3col desktop)
 * - Compact-scroll variant: horizontal scrollable flex row
 * - Loading state with CampaignCardSkeleton placeholders
 * - IntersectionObserver for staggered fade-in scroll animations
 * - Infinite scroll: triggers onLoadMore when bottom sentinel enters viewport
 * - Empty state with illustration when no campaigns
 */
export function CampaignGrid({
  campaigns,
  variant,
  isLoading = false,
  skeletonCount = 6,
  emptyMessage = 'Belum ada campaign',
  onLoadMore,
  hasMore = false,
}: CampaignGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll: observe bottom sentinel and trigger onLoadMore
  useEffect(() => {
    if (!hasMore || !onLoadMore || !sentinelRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          onLoadMore();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  // Initial loading: no campaigns yet
  if (isLoading && campaigns.length === 0) {
    return (
      <CampaignCardSkeleton
        variant={variant === 'compact-scroll' ? 'compact' : 'standard'}
        count={skeletonCount}
      />
    );
  }

  // Empty state: no campaigns and not loading
  if (campaigns.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        {/* Empty state illustration */}
        <div className="w-24 h-24 mb-4 rounded-full bg-bg-secondary flex items-center justify-center">
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M24 4C12.954 4 4 12.954 4 24s8.954 20 20 20 20-8.954 20-20S35.046 4 24 4z"
              stroke="#E0E0E0"
              strokeWidth="2"
              fill="none"
            />
            <path
              d="M16 28s2.5 4 8 4 8-4 8-4"
              stroke="#BDBDBD"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="18" cy="20" r="2" fill="#BDBDBD" />
            <circle cx="30" cy="20" r="2" fill="#BDBDBD" />
          </svg>
        </div>
        <p className="text-text-secondary text-sm text-center">{emptyMessage}</p>
      </div>
    );
  }

  // Compact-scroll variant: horizontal scrollable row
  if (variant === 'compact-scroll') {
    return (
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
        {campaigns.map((campaign) => (
          <AnimatedCard key={campaign.id}>
            <CampaignCard
              campaign={{
                ...campaign,
                deadline: campaign.deadline ? campaign.deadline.toString() : null,
              }}
              variant="compact"
            />
          </AnimatedCard>
        ))}
      </div>
    );
  }

  // Standard variant: responsive grid with infinite scroll
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {campaigns.map((campaign) => (
          <AnimatedCard key={campaign.id}>
            <CampaignCard
              campaign={{
                ...campaign,
                deadline: campaign.deadline ? campaign.deadline.toString() : null,
              }}
              variant="standard"
            />
          </AnimatedCard>
        ))}
      </div>

      {/* Loading indicator at bottom when fetching more */}
      {hasMore && isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          {Array.from({ length: 3 }, (_, i) => (
            <CampaignCardSkeleton key={`loading-more-${i}`} variant="standard" />
          ))}
        </div>
      )}

      {/* Bottom sentinel for infinite scroll */}
      {hasMore && !isLoading && (
        <div ref={sentinelRef} className="h-4" aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * AnimatedCard wraps each campaign card with IntersectionObserver-based
 * staggered fade-in animation on scroll.
 */
function AnimatedCard({ children }: { children: React.ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  const onIntersect = useCallback((entries: IntersectionObserverEntry[]) => {
    const entry = entries[0];
    if (entry?.isIntersecting) {
      setIsVisible(true);
    }
  }, []);

  useEffect(() => {
    if (!cardRef.current) return;

    const observer = new IntersectionObserver(onIntersect, {
      threshold: 0.1,
      rootMargin: '50px',
    });

    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [onIntersect]);

  return (
    <div
      ref={cardRef}
      className={`transition-all duration-500 ease-out ${
        isVisible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-4'
      }`}
    >
      {children}
    </div>
  );
}

export default CampaignGrid;
