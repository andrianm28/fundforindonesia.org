'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { usePrayerStream, PrayerStreamItem } from '@/lib/hooks/usePrayerStream';
import { getRelativeTimestamp } from '@/lib/utils/date';

export interface PrayerWallProps {
  initialPrayers: PrayerStreamItem[];
  maxVisible?: number;
  showCampaignLink?: boolean;
  variant: 'homepage' | 'campaign-detail';
}

/**
 * PrayerWall displays a live feed of prayers from donors with real-time updates via SSE.
 * Supports optimistic amiin interactions with revert-on-failure.
 *
 * Two variants:
 * - homepage: Includes section header "Doa-doa #OrangBaik" and campaign links
 * - campaign-detail: Displays prayers for a specific campaign without campaign links
 */
export function PrayerWall({
  initialPrayers,
  maxVisible = 10,
  showCampaignLink = false,
  variant,
}: PrayerWallProps) {
  const { prayers } = usePrayerStream({
    initialPrayers,
  });

  const [showAll, setShowAll] = useState(false);
  const [amiinStates, setAmiinStates] = useState<Record<string, number>>({});
  const [animatingAmiin, setAnimatingAmiin] = useState<Record<string, boolean>>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const visiblePrayers = showAll ? prayers : prayers.slice(0, maxVisible);
  const hasMore = prayers.length > maxVisible;

  // Get the amiin count for a prayer (optimistic or original)
  const getAmiinCount = useCallback(
    (prayer: PrayerStreamItem) => {
      return amiinStates[prayer.id] ?? prayer.amiinCount;
    },
    [amiinStates]
  );

  // Show toast notification
  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // Handle amiin button click with optimistic update
  const handleAmiin = useCallback(
    async (prayerId: string, currentCount: number) => {
      // Optimistic increment
      const newCount = currentCount + 1;
      setAmiinStates((prev) => ({ ...prev, [prayerId]: newCount }));

      // Trigger pulse animation
      setAnimatingAmiin((prev) => ({ ...prev, [prayerId]: true }));
      setTimeout(() => {
        setAnimatingAmiin((prev) => ({ ...prev, [prayerId]: false }));
      }, 600);

      try {
        const res = await fetch(`/api/prayers/${prayerId}/amiin`, {
          method: 'POST',
        });

        if (!res.ok) {
          throw new Error('Failed to amiin');
        }
      } catch {
        // Revert on failure
        setAmiinStates((prev) => ({ ...prev, [prayerId]: currentCount }));
        showToast('Gagal mengirim Aamiin. Coba lagi.');
      }
    },
    [showToast]
  );

  return (
    <section className="w-full" aria-label="Prayer Wall">
      {/* Section Header - Homepage variant only */}
      {variant === 'homepage' && (
        <div className="mb-4">
          <h2 className="text-lg font-bold text-text">
            Doa-doa #OrangBaik
          </h2>
        </div>
      )}

      {/* Prayer List */}
      <div className="space-y-4">
        <AnimatePresence initial={false}>
          {visiblePrayers.map((prayer) => (
            <PrayerCard
              key={prayer.id}
              prayer={prayer}
              amiinCount={getAmiinCount(prayer)}
              isAnimating={animatingAmiin[prayer.id] ?? false}
              showCampaignLink={showCampaignLink}
              onAmiin={() => handleAmiin(prayer.id, getAmiinCount(prayer))}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Show More Button */}
      {hasMore && !showAll && (
        <div className="mt-4 text-center">
          <button
            onClick={() => setShowAll(true)}
            className="text-sm font-semibold text-primary hover:text-primary-dark transition-colors"
          >
            Lihat lebih banyak
          </button>
        </div>
      )}

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-elevated z-50"
          >
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// --- PrayerCard Sub-component ---

interface PrayerCardProps {
  prayer: PrayerStreamItem;
  amiinCount: number;
  isAnimating: boolean;
  showCampaignLink: boolean;
  onAmiin: () => void;
}

function PrayerCard({
  prayer,
  amiinCount,
  isAnimating,
  showCampaignLink,
  onAmiin,
}: PrayerCardProps) {
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

        {/* Campaign Link */}
        {showCampaignLink && prayer.campaign && (
          <Link
            href={`/campaign/${prayer.campaign.slug}`}
            className="text-xs text-primary hover:underline block mb-1 truncate"
          >
            untuk {prayer.campaign.title}
          </Link>
        )}

        {/* Prayer Text */}
        <p className="text-sm text-text-secondary leading-relaxed">
          {prayer.text}
        </p>

        {/* Amiin Button */}
        <div className="mt-2">
          <button
            onClick={onAmiin}
            className={`
              inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
              border border-border hover:border-primary hover:text-primary
              transition-all duration-150
              ${isAnimating ? 'animate-amiin-pulse' : ''}
            `}
            aria-label={`Aamiin (${amiinCount})`}
          >
            <span className="text-sm">🤲</span>
            <span>Aamiin</span>
            {amiinCount > 0 && (
              <span className="text-text-secondary">({amiinCount})</span>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default PrayerWall;
