'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { formatRupiah } from '@/lib/utils/currency';
import { getRemainingDays } from '@/lib/utils/date';

export interface CampaignDetailData {
  id: string;
  slug: string;
  title: string;
  description: string;
  story: string;
  coverImage: string;
  targetAmount: number;
  collectedAmount: number;
  category: string;
  status: string;
  isUrgent: boolean;
  /** Sample content (task M9) -- the badge below is additional, not the refusal mechanism; POST /api/donations refuses it regardless. */
  isDemo: boolean;
  deadline: string | null;
  createdAt: string;
  creator: {
    id: string;
    name: string;
    avatar: string | null;
    isVerified: boolean;
    verificationType: string | null;
  };
  donationCount: number;
}

interface CampaignDetailViewProps {
  campaign: CampaignDetailData;
}

/**
 * CampaignDetailView renders the full campaign detail page.
 * This is a client component that receives pre-fetched campaign data
 * from the server component page.
 *
 * Displays: cover image, title, amounts, progress bar, creator info,
 * and the campaign story HTML content.
 *
 * Tabs (Kabar Terbaru, Pencairan Dana) and CTA button will be
 * composed in subsequent tasks (14.2-14.4).
 */
export function CampaignDetailView({ campaign }: CampaignDetailViewProps) {
  const router = useRouter();

  const remainingDays = campaign.deadline
    ? getRemainingDays(new Date(campaign.deadline))
    : null;

  const percentage = campaign.targetAmount > 0
    ? Math.min((campaign.collectedAmount / campaign.targetAmount) * 100, 100)
    : 0;

  return (
    <div className="min-h-screen bg-white pb-20">
      {/* Back button header */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-text hover:text-primary transition-colors"
            aria-label="Kembali"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <h1 className="text-sm font-medium text-text truncate flex-1">
            {campaign.title}
          </h1>
          {/* Share button placeholder */}
          <button
            className="text-text hover:text-primary transition-colors"
            aria-label="Bagikan"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Hero image + quick info panel -- stacked by default, side-by-side
          from lg (1025px) up. The donate CTA is NOT duplicated here: it is
          already a `fixed` bottom bar, already visible on every viewport
          regardless of scroll, below. */}
      <div
        data-testid="campaign-hero-section"
        className="lg:flex lg:flex-row lg:gap-8 lg:items-start lg:max-w-5xl lg:mx-auto lg:px-4 lg:pt-6"
      >
        {/* Cover Image */}
        <div
          data-testid="campaign-hero-image"
          className="relative w-full aspect-video max-h-[300px] overflow-hidden lg:w-3/5 lg:max-h-none lg:aspect-[21/9] lg:rounded-lg"
        >
          <Image
            src={campaign.coverImage}
            alt={campaign.title}
            fill
            className="object-cover"
            priority
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 768px, 600px"
          />
          {campaign.isUrgent && (
            <span className="absolute top-3 left-3 bg-danger text-white text-xs font-semibold px-2.5 py-1 rounded">
              DARURAT
            </span>
          )}
        </div>

        {/* Quick info panel: demo badge, title, amount, progress, stats, donation count */}
        <div
          data-testid="campaign-quick-info"
          className="max-w-3xl mx-auto px-4 pt-4 lg:max-w-none lg:mx-0 lg:px-0 lg:py-0 lg:w-2/5"
        >
          {/* Demo campaign badge (task M9) -- plain Indonesian, above the
              title, so it is seen before "Donasi sekarang" at the bottom is
              ever tapped, not discovered after the donation is refused. */}
          {campaign.isDemo && (
            <span className="inline-block bg-gray-800/90 text-white text-xs font-semibold px-2.5 py-1 rounded mb-2">
              Kampanye contoh — tidak menerima donasi sungguhan
            </span>
          )}

          {/* Title */}
          <h2 className="text-lg font-bold text-text leading-tight mb-3">
            {campaign.title}
          </h2>

          {/* Amount collected */}
          <div className="space-y-2 mb-4">
            <p className="text-xl font-bold text-primary font-mono">
              {formatRupiah(campaign.collectedAmount)}
            </p>

            {/* Progress bar */}
            <ProgressBar
              current={campaign.collectedAmount}
              target={campaign.targetAmount}
              size="md"
              animated
            />

            {/* Stats row */}
            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span>
                terkumpul dari{' '}
                <span className="font-medium text-text">
                  {formatRupiah(campaign.targetAmount)}
                </span>
              </span>
              {remainingDays !== null && remainingDays > 0 && (
                <span className="font-medium">{remainingDays} hari lagi</span>
              )}
              {remainingDays !== null && remainingDays === 0 && (
                <span className="font-medium text-danger">Berakhir</span>
              )}
            </div>

            {/* Donation count */}
            <p className="text-xs text-text-secondary">
              <span className="font-semibold text-text">{campaign.donationCount.toLocaleString('id-ID')}</span>{' '}
              donatur
            </p>
          </div>
        </div>
      </div>

      {/* Creator info, tabs, and campaign story -- full width, below the
          hero section on every viewport */}
      <div className="max-w-3xl mx-auto px-4 pb-4 lg:py-4">
        {/* Creator info */}
        <div className="flex items-center gap-3 py-3 border-t border-b border-border mb-4">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-100 flex-shrink-0">
            {campaign.creator.avatar ? (
              <Image
                src={campaign.creator.avatar}
                alt={campaign.creator.name}
                width={40}
                height={40}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-text-secondary text-sm font-semibold">
                {campaign.creator.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          {/* Creator details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-sm font-medium text-text truncate">
                {campaign.creator.name}
              </span>
            </div>
          </div>
        </div>

        {/* Tab navigation placeholder - will be replaced in task 14.2 */}
        <div className="flex gap-4 border-b border-border mb-4">
          <button className="pb-2 text-sm font-medium text-primary border-b-2 border-primary">
            Cerita
          </button>
          <button className="pb-2 text-sm font-medium text-text-secondary hover:text-text transition-colors">
            Kabar Terbaru
          </button>
          <button className="pb-2 text-sm font-medium text-text-secondary hover:text-text transition-colors">
            Pencairan Dana
          </button>
        </div>

        {/* Campaign Story */}
        <div
          className="prose prose-sm max-w-none text-text leading-relaxed
            prose-headings:text-text prose-headings:font-semibold
            prose-p:text-text prose-p:leading-relaxed
            prose-img:rounded-lg prose-img:my-4
            prose-a:text-primary prose-a:no-underline hover:prose-a:underline"
          dangerouslySetInnerHTML={{ __html: campaign.story }}
        />
      </div>

      {/* Fixed bottom CTA -- already visible on every viewport regardless of
          scroll position (position: fixed), so this alone already satisfies
          "donate button visible without scrolling" on desktop too; no
          separate desktop-specific button is added (see this task's Design
          decision above). */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border p-4 z-10">
        <div className="max-w-3xl mx-auto">
          <Link
            href={`/campaign/${campaign.slug}/donate`}
            className="block w-full py-3 rounded-lg font-semibold text-base text-center bg-primary text-white hover:bg-primary-dark transition-colors"
          >
            Donasi sekarang
          </Link>
        </div>
      </div>
    </div>
  );
}

export default CampaignDetailView;
