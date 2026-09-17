'use client';

import React, { useState } from 'react';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import type { CampaignCardData, Category } from '@/types/campaign';

export interface CategorySectionProps {
  categories: Category[];
  campaignsByCategory: Record<string, CampaignCardData[]>;
  isLoading?: boolean;
}

/**
 * CategorySection — "Pilih Kategori Favoritmu" section.
 *
 * Displays horizontally scrollable category pills/tabs.
 * When a category is selected, shows campaigns for that category below.
 *
 * Validates: Requirements 1.7, 5.1, 5.2
 */
export function CategorySection({
  categories,
  campaignsByCategory,
  isLoading = false,
}: CategorySectionProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>(
    categories[0]?.slug ?? ''
  );

  const selectedCampaigns = campaignsByCategory[selectedCategory] ?? [];

  if (!isLoading && categories.length === 0) return null;

  return (
    <section className="py-6">
      <div className="px-4 mb-3">
        <h2 className="text-lg font-bold text-text">Pilih Kategori Favoritmu</h2>
      </div>

      {/* Category pills - horizontally scrollable */}
      <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide">
        {categories.map((category) => (
          <button
            key={category.slug}
            onClick={() => setSelectedCategory(category.slug)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
              selectedCategory === category.slug
                ? 'bg-primary text-white'
                : 'bg-bg-secondary text-text-secondary hover:bg-border'
            }`}
            aria-pressed={selectedCategory === category.slug}
          >
            <span className="text-base" aria-hidden="true">
              {category.icon}
            </span>
            <span>{category.name}</span>
          </button>
        ))}
      </div>

      {/* Campaigns for selected category */}
      <div className="px-4">
        <CampaignGrid
          campaigns={selectedCampaigns}
          variant="compact-scroll"
          isLoading={isLoading}
          skeletonCount={3}
          emptyMessage={`Belum ada campaign di kategori ini`}
        />
      </div>
    </section>
  );
}

export default CategorySection;
