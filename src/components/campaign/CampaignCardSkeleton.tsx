import React from 'react';
import { Skeleton } from '../ui/Skeleton';

export interface CampaignCardSkeletonProps {
  variant: 'compact' | 'standard';
  count?: number;
}

/**
 * Skeleton loading placeholder for CampaignCard.
 * Matches the exact layout dimensions of CampaignCard with shimmer animation.
 * Supports rendering multiple skeletons for grid/scroll loading states.
 */
export function CampaignCardSkeleton({
  variant,
  count = 1,
}: CampaignCardSkeletonProps) {
  const skeletons = Array.from({ length: count }, (_, i) => (
    <SingleCampaignCardSkeleton key={i} variant={variant} />
  ));

  if (count <= 1) {
    return <>{skeletons}</>;
  }

  // Multiple skeletons: standard uses grid, compact uses flex row
  if (variant === 'standard') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {skeletons}
      </div>
    );
  }

  // compact: horizontal flex row with gap for scroll container
  return (
    <div className="flex gap-4 overflow-x-auto">
      {skeletons}
    </div>
  );
}

function SingleCampaignCardSkeleton({ variant }: { variant: 'compact' | 'standard' }) {
  const isCompact = variant === 'compact';

  return (
    <div
      className="rounded-md overflow-hidden shadow-card bg-white shrink-0"
      style={{ width: isCompact ? '280px' : undefined }}
      role="status"
      aria-label="Loading campaign"
    >
      {/* Image area (16:9 aspect ratio) */}
      <Skeleton variant="rectangular" width="100%" height={0} className="h-0! pb-[56.25%]!" />

      {/* Content area */}
      <div className="p-3 flex flex-col gap-2">
        {/* Title — 2 text lines */}
        <Skeleton variant="text" lines={2} height={14} />

        {/* Creator line */}
        <div className="flex items-center gap-2 mt-1">
          <Skeleton variant="circular" width={20} />
          <Skeleton variant="rectangular" width="50%" height={12} />
        </div>

        {/* Progress bar */}
        <Skeleton variant="rectangular" width="100%" height={8} className="rounded-full! mt-1" />

        {/* Amount + days row */}
        <div className="flex justify-between items-center mt-1">
          <Skeleton variant="rectangular" width="45%" height={12} />
          <Skeleton variant="rectangular" width="25%" height={12} />
        </div>
      </div>
    </div>
  );
}

export default CampaignCardSkeleton;
