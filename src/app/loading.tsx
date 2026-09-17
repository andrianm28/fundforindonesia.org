import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Full-page skeleton loading state for the homepage.
 * Matches the target layout structure: Hero → Quick Actions → Campaign Sections → Prayer Wall.
 * Shown while Next.js is fetching server component data.
 */
export default function HomeLoading() {
  return (
    <div className="min-h-screen">
      {/* Hero Banner Skeleton */}
      <div className="w-full aspect-[16/9] md:aspect-[21/9] lg:aspect-[3/1]">
        <Skeleton variant="rectangular" width="100%" height="100%" />
      </div>

      {/* Quick Action Tiles Skeleton */}
      <section className="px-4 py-4">
        <div className="grid grid-cols-4 gap-3 sm:gap-4 md:grid-cols-5 lg:grid-cols-8">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton variant="circular" width={48} height={48} />
              <Skeleton variant="text" width={48} height={10} />
            </div>
          ))}
        </div>
      </section>

      {/* Urgent Campaigns Section Skeleton */}
      <section className="px-4 py-4">
        <Skeleton variant="text" width={220} height={20} className="mb-3" />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="w-[280px] flex-shrink-0">
              <Skeleton variant="card" />
            </div>
          ))}
        </div>
      </section>

      {/* New Campaigns Section Skeleton */}
      <section className="px-4 py-4">
        <Skeleton variant="text" width={200} height={20} className="mb-3" />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="w-[280px] flex-shrink-0">
              <Skeleton variant="card" />
            </div>
          ))}
        </div>
      </section>

      {/* Featured Campaigns Grid Skeleton */}
      <section className="px-4 py-4">
        <Skeleton variant="text" width={160} height={20} className="mb-3" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} variant="card" />
          ))}
        </div>
      </section>

      {/* Prayer Wall Skeleton */}
      <section className="px-4 py-4">
        <Skeleton variant="text" width={180} height={20} className="mb-3" />
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex gap-3 p-3 bg-white rounded-lg border border-border">
              <Skeleton variant="circular" width={40} height={40} />
              <div className="flex-1">
                <Skeleton variant="text" width="60%" height={14} />
                <Skeleton variant="text" width="100%" height={12} className="mt-2" />
                <Skeleton variant="text" width="80%" height={12} className="mt-1" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
