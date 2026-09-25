'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { LazyImage } from '@/components/ui/LazyImage';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { formatRupiah } from '@/lib/utils/currency';
import { getRemainingDays } from '@/lib/utils/date';

export interface CampaignCardProps {
  campaign: {
    id: string;
    slug: string;
    title: string;
    coverImage: string;
    collectedAmount: number;
    targetAmount: number;
    category: string;
    deadline: string | null;
    isUrgent: boolean;
    /** Sample content (task M9) -- cannot receive donations. Shown as a badge, not a tooltip. */
    isDemo?: boolean;
    creator: {
      name: string;
      isVerified: boolean;
      verificationType: string | null;
    };
  };
  variant: 'compact' | 'standard';
  showCreator?: boolean;
  showDaysRemaining?: boolean;
  onClick?: () => void;
}

/**
 * CampaignCard displays a campaign summary with cover image,
 * title, creator info, progress bar, amount collected, and days remaining.
 *
 * Supports two variants:
 * - standard: vertical card, full width (for grids)
 * - compact: fixed width 280px (for horizontal scroll)
 *
 * Includes hover lift micro-interaction via Framer Motion.
 * Navigates to /campaign/[slug] on click.
 */
export function CampaignCard({
  campaign,
  variant,
  showCreator = true,
  showDaysRemaining = true,
  onClick,
}: CampaignCardProps) {
  const router = useRouter();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      router.push(`/campaign/${campaign.slug}`);
    }
  };

  const remainingDays = campaign.deadline
    ? getRemainingDays(new Date(campaign.deadline))
    : null;

  const widthClass = variant === 'compact' ? 'w-[280px] flex-shrink-0' : 'w-full';

  return (
    <motion.div
      className={`${widthClass} rounded-lg shadow-card bg-white overflow-hidden cursor-pointer`}
      whileHover={{ y: -2, boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)' }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      onClick={handleClick}
      role="article"
      aria-label={`Campaign: ${campaign.title}`}
    >
      {/* Cover Image - 16:9 aspect ratio */}
      <div className="relative w-full aspect-video">
        <LazyImage
          src={campaign.coverImage}
          alt={campaign.title}
          width={400}
          height={225}
          className="w-full h-full"
        />
        {campaign.isUrgent && (
          <span className="absolute top-2 left-2 bg-danger text-white text-xs font-semibold px-2 py-0.5 rounded">
            DARURAT
          </span>
        )}
        {/* Demo campaigns (task M9) cannot receive donations -- this badge
            says so before a donor ever taps through, not after they are
            refused. Plain Indonesian text, not a tooltip, so it reads at a
            glance on a phone the same way DARURAT does. */}
        {campaign.isDemo && (
          <span className="absolute top-2 right-2 bg-gray-800/90 text-white text-xs font-semibold px-2 py-0.5 rounded">
            Kampanye contoh
          </span>
        )}
      </div>

      {/* Card Content */}
      <div className="p-3">
        {/* Title - 2-line clamp */}
        <h3 className="text-sm font-semibold text-text line-clamp-2 mb-1.5 leading-snug">
          {campaign.title}
        </h3>

        {/* Creator with verification badge */}
        {showCreator && (
          <div className="flex items-center gap-1 mb-2">
            <span className="text-xs text-text-secondary truncate">
              {campaign.creator.name}
            </span>
          </div>
        )}

        {/* Progress Bar */}
        <div className="mb-2">
          <ProgressBar
            current={campaign.collectedAmount}
            target={campaign.targetAmount}
            size="sm"
            animated={false}
            showLedgerLine
          />
        </div>

        {/* Amount and Days Remaining */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-text">
              {formatRupiah(campaign.collectedAmount)}
            </p>
            <p className="text-[10px] text-text-secondary">Terkumpul</p>
          </div>

          {showDaysRemaining && remainingDays !== null && remainingDays > 0 && (
            <div className="text-right">
              <p className="text-xs font-semibold text-text-secondary">
                {remainingDays} hari lagi
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default CampaignCard;
