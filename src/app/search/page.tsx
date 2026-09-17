'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useCampaigns } from '@/lib/hooks/useCampaigns';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import { CategoryFilter } from '@/components/search/CategoryFilter';
import SearchBar from '@/components/shared/SearchBar';
import Link from 'next/link';

const suggestedCategories = [
  { name: 'Bencana Alam', slug: 'bencana-alam' },
  { name: 'Kesehatan', slug: 'kesehatan' },
  { name: 'Pendidikan', slug: 'pendidikan' },
  { name: 'Balita & Anak Sakit', slug: 'anak' },
];

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.get('q') || '';
  const category = searchParams.get('category') || undefined;

  const { data: categoriesData } = useSWR<{ categories: { id: string; name: string; slug: string }[] }>(
    '/api/categories',
    (url: string) => fetch(url).then((res) => res.json())
  );

  const { campaigns, total, isLoading } = useCampaigns({ search: query, category });

  const handleCategorySelect = (slug: string | null) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (slug) params.set('category', slug);
    const qs = params.toString();
    router.push(`/search${qs ? `?${qs}` : ''}`);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Search header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3">
        <SearchBar defaultValue={query} className="max-w-2xl mx-auto" />
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Category filter */}
        {categoriesData?.categories && categoriesData.categories.length > 0 && (
          <div className="mb-4">
            <CategoryFilter
              categories={categoriesData.categories}
              activeSlug={category ?? null}
              onSelect={handleCategorySelect}
            />
          </div>
        )}

        {/* Result count */}
        {query && !isLoading && campaigns.length > 0 && (
          <p className="text-sm text-text-secondary mb-4">
            Ditemukan {total} campaign untuk &lsquo;{query}&rsquo;
          </p>
        )}

        {/* Campaign results */}
        {query || category ? (
          <>
            {/* Loading state */}
            {isLoading && (
              <CampaignGrid
                campaigns={[]}
                variant="standard"
                isLoading={true}
                skeletonCount={6}
              />
            )}

            {/* Results */}
            {!isLoading && campaigns.length > 0 && (
              <CampaignGrid
                campaigns={campaigns.map((c) => ({
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
                    isVerified: c.creator.isVerified,
                    verificationType: c.creator.verificationType ?? null,
                  },
                }))}
                variant="standard"
              />
            )}

            {/* Empty state - category filter active */}
            {!isLoading && campaigns.length === 0 && category && (
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className="w-20 h-20 mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <path
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      stroke="#9CA3AF"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <p className="text-text text-base font-medium mb-2 text-center">
                  Tidak ada kampanye ditemukan dalam kategori ini
                </p>
              </div>
            )}

            {/* Empty state - search query with no results */}
            {!isLoading && campaigns.length === 0 && !category && (
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className="w-20 h-20 mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <path
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      stroke="#9CA3AF"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <p className="text-text text-base font-medium mb-2 text-center">
                  Tidak ditemukan campaign dengan kata kunci tersebut
                </p>
                <p className="text-text-secondary text-sm mb-6 text-center">
                  Coba kata kunci lain atau jelajahi kategori berikut
                </p>

                {/* Suggested categories */}
                <div className="flex flex-wrap gap-2 justify-center">
                  {suggestedCategories.map((cat) => (
                    <Link
                      key={cat.slug}
                      href={`/explore/${cat.slug}`}
                      className="px-4 py-2 rounded-full bg-blue-50 text-primary text-sm font-medium hover:bg-blue-100 transition-colors"
                    >
                      {cat.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* No query state */
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="w-20 h-20 mb-4 rounded-full bg-gray-100 flex items-center justify-center">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  stroke="#9CA3AF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="text-text-secondary text-sm text-center mb-6">
              Cari campaign yang ingin kamu bantu
            </p>

            {/* Suggested categories */}
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestedCategories.map((cat) => (
                <Link
                  key={cat.slug}
                  href={`/explore/${cat.slug}`}
                  className="px-4 py-2 rounded-full bg-blue-50 text-primary text-sm font-medium hover:bg-blue-100 transition-colors"
                >
                  {cat.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white">
          <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3">
            <div className="max-w-2xl mx-auto h-10 bg-gray-100 rounded-full animate-pulse" />
          </div>
          <div className="max-w-4xl mx-auto px-4 py-6">
            <div className="h-4 w-48 bg-gray-100 rounded animate-pulse mb-4" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="rounded-xl overflow-hidden">
                  <div className="aspect-video bg-gray-100 animate-pulse" />
                  <div className="p-3 space-y-2">
                    <div className="h-4 bg-gray-100 rounded animate-pulse" />
                    <div className="h-3 w-3/4 bg-gray-100 rounded animate-pulse" />
                    <div className="h-2 bg-gray-100 rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
