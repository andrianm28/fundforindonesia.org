'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PrayerStreamItem } from '@/lib/hooks/usePrayerStream';
import { getRelativeTimestamp } from '@/lib/utils/date';
import { useAamiin } from '@/lib/hooks/useAamiin';

export interface CampaignPrayersProps {
  campaignSlug: string;
  initialPrayers?: PrayerStreamItem[];
}

/**
 * CampaignPrayers displays the "Doa-doa Orang Baik" section on the campaign detail page.
 * Shows donor prayers with timestamps and amiin interaction, with load more pagination.
 *
 * Features:
 * - Section header with total prayer count
 * - Prayer list with avatar, donor name (or "Anonim"), prayer text, timestamp
 * - Optimistic amiin increment with pulse animation
 * - "Lihat lebih banyak" load more button with pagination
 *
 * Validates: Requirements 4.11, 9.3
 */
export function CampaignPrayers({
  campaignSlug,
  initialPrayers = [],
}: CampaignPrayersProps) {
  const [prayers, setPrayers] = useState<PrayerStreamItem[]>(initialPrayers);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialPrayers.length >= 5);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const totalCount = prayers.length;
  const amiin = useAamiin(prayers);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // Load more prayers with pagination
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await fetch(
        `/api/prayers?campaignSlug=${encodeURIComponent(campaignSlug)}&page=${nextPage}&limit=5`
      );

      if (!res.ok) {
        throw new Error('Failed to load more prayers');
      }

      const data = await res.json();
      const newPrayers: PrayerStreamItem[] = (data.prayers ?? []).map(
        (p: Record<string, unknown>) => ({
          id: p.id as string,
          text: p.text as string,
          amiinCount: p.amiinCount as number,
          donationId: (p.donationId as string) || '',
          campaignId: (p.campaignId as string) || '',
          userId: p.userId as string | null,
          createdAt: new Date(p.createdAt as string),
          user: p.donorName
            ? { id: '', name: p.donorName as string, avatar: p.donorAvatar as string | null }
            : null,
          campaign: p.campaignSlug
            ? {
                id: '',
                slug: p.campaignSlug as string,
                title: p.campaignTitle as string,
              }
            : undefined,
        })
      );

      setPrayers((prev) => {
        // Deduplicate
        const existingIds = new Set(prev.map((p) => p.id));
        const unique = newPrayers.filter((p) => !existingIds.has(p.id));
        return [...prev, ...unique];
      });

      setPage(nextPage);
      setHasMore(newPrayers.length >= 5);
    } catch {
      showToast('Gagal memuat doa lainnya. Coba lagi.');
    } finally {
      setIsLoadingMore(false);
    }
  }, [campaignSlug, page, isLoadingMore, showToast]);

  return (
    <section className="w-full" aria-label="Doa-doa Orang Baik">
      {/* Section Header */}
      <div className="mb-4">
        <h2 className="text-lg font-bold text-text">
          Doa-doa Orang Baik
          {totalCount > 0 && (
            <span className="text-sm font-normal text-text-secondary ml-2">
              ({totalCount})
            </span>
          )}
        </h2>
      </div>

      {/* Prayer List */}
      {prayers.length === 0 ? (
        <div className="text-center py-8 text-text-secondary text-sm">
          Belum ada doa untuk campaign ini.
        </div>
      ) : (
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {prayers.map((prayer) => (
              <CampaignPrayerCard
                key={prayer.id}
                prayer={prayer}
                amiinCount={amiin.countOf(prayer)}
                isAnimating={amiin.isAnimating(prayer.id)}
                isGiven={amiin.isGiven(prayer.id)}
                onAmiin={() => amiin.give(prayer.id, amiin.countOf(prayer))}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Load More Button */}
      {hasMore && (
        <div className="mt-4 text-center">
          <button
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            className="text-sm font-semibold text-primary hover:text-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoadingMore ? 'Memuat...' : 'Lihat lebih banyak'}
          </button>
        </div>
      )}

      {/* Toast Notification */}
      <AnimatePresence>
        {(toastMessage ?? amiin.toastMessage) && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-elevated z-50"
          >
            {toastMessage ?? amiin.toastMessage}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// --- CampaignPrayerCard Sub-component ---

interface CampaignPrayerCardProps {
  prayer: PrayerStreamItem;
  amiinCount: number;
  isAnimating: boolean;
  isGiven: boolean;
  onAmiin: () => void;
}

function CampaignPrayerCard({
  prayer,
  amiinCount,
  isAnimating,
  isGiven,
  onAmiin,
}: CampaignPrayerCardProps) {
  const donorName = prayer.user?.name || 'Anonim';
  const avatarUrl = prayer.user?.avatar ?? null;
  const timestamp = getRelativeTimestamp(new Date(prayer.createdAt));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex gap-3 p-3 bg-white rounded-lg border border-border"
    >
      {/* Avatar */}
      <div className="shrink-0">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={donorName}
            className="w-10 h-10 rounded-full object-cover"
            width={40}
            height={40}
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
            <span className="text-sm font-semibold text-gray-500">
              {donorName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Name and Timestamp */}
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-text truncate">
            {donorName}
          </span>
          <span className="text-xs text-text-secondary shrink-0">
            {timestamp}
          </span>
        </div>

        {/* Prayer Text */}
        <p className="text-sm text-text-secondary leading-relaxed">
          {prayer.text}
        </p>

        {/* Amiin Button */}
        <div className="mt-2">
          <button
            onClick={onAmiin}
            disabled={isGiven}
            aria-pressed={isGiven}
            className={`
              inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
              border transition-all duration-150
              ${isGiven ? 'border-primary text-primary bg-primary/10 cursor-default' : 'border-border hover:border-primary hover:text-primary'}
              ${isAnimating ? 'animate-amiin-pulse' : ''}
            `}
            aria-label={`Aamiin (${amiinCount})`}
          >
            <span className="text-sm">🤲</span>
            <span>{isGiven ? 'Sudah Aamiin' : 'Aamiin'}</span>
            {amiinCount > 0 && (
              <span className="text-text-secondary">({amiinCount})</span>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default CampaignPrayers;
