import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Campaign detail loading skeleton.
 * Shows full-width image skeleton + content block skeletons
 * matching the campaign detail layout.
 */
export default function CampaignDetailLoading() {
  return (
    <div className="min-h-screen bg-white">
      {/* Cover Image Skeleton - full width, 16:9 aspect ratio */}
      <Skeleton
        variant="rectangular"
        width="100%"
        height="250px"
        className="w-full"
      />

      {/* Content area */}
      <div className="px-4 py-4 space-y-4 max-w-3xl mx-auto">
        {/* Title skeleton */}
        <Skeleton variant="text" lines={2} height="24px" />

        {/* Amount and progress section */}
        <div className="space-y-3">
          {/* Collected amount */}
          <Skeleton variant="text" width="60%" height="28px" />

          {/* Progress bar */}
          <Skeleton variant="rectangular" width="100%" height="8px" />

          {/* Stats row: target, days, donors */}
          <div className="flex justify-between">
            <Skeleton variant="text" width="30%" height="14px" />
            <Skeleton variant="text" width="25%" height="14px" />
            <Skeleton variant="text" width="20%" height="14px" />
          </div>
        </div>

        {/* Creator info skeleton */}
        <div className="flex items-center gap-3 py-3 border-t border-b border-border">
          <Skeleton variant="circular" width={40} height={40} />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="40%" height="14px" />
            <Skeleton variant="text" width="60%" height="12px" />
          </div>
        </div>

        {/* Tab navigation skeleton */}
        <div className="flex gap-4 border-b border-border pb-3">
          <Skeleton variant="text" width="25%" height="16px" />
          <Skeleton variant="text" width="30%" height="16px" />
          <Skeleton variant="text" width="20%" height="16px" />
        </div>

        {/* Story content skeleton */}
        <div className="space-y-3 pt-2">
          <Skeleton variant="text" lines={4} height="14px" />
          <Skeleton variant="rectangular" width="100%" height="180px" />
          <Skeleton variant="text" lines={3} height="14px" />
          <Skeleton variant="text" lines={2} height="14px" />
        </div>
      </div>

      {/* Fixed bottom CTA skeleton */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border p-4">
        <div className="max-w-3xl mx-auto">
          <Skeleton variant="rectangular" width="100%" height="48px" />
        </div>
      </div>
    </div>
  );
}
