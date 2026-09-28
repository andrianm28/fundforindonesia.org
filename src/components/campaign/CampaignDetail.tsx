'use client';

import React, { useState, useEffect } from 'react';
import { LazyImage } from '@/components/ui/LazyImage';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { formatRupiah } from '@/lib/utils/currency';
import { getRemainingDays } from '@/lib/utils/date';
import { offersDonating } from '@/lib/campaign-page-status';
import type { CampaignLifecycleStatus } from '@/types/campaign';
import { CampaignStatusBanner } from './CampaignStatusBanner';

export interface CampaignDetailProps {
  campaign: {
    id: string;
    slug: string;
    title: string;
    description: string;
    story: string;
    coverImage: string;
    targetAmount: number;
    collectedAmount: number;
    category: string;
    /** Effective status, as GET /api/campaigns/[slug] returns it. */
    lifecycleStatus: CampaignLifecycleStatus;
    /** Present only in the owning Fundraiser's payload. */
    suspensionReason?: string | null;
    isUrgent: boolean;
    deadline: string | null;
    createdAt: string;
    updatedAt: string;
    donationCount: number;
    creator: {
      id: string;
      name: string;
      avatar: string | null;
    };
  };
  onDonate: () => void;
  onShare: () => void;
}

interface CampaignUpdate {
  id: string;
  title: string;
  content: string;
  images: string[];
  createdAt: string;
}

/** A Payout's Usage Report, as GET /api/campaigns/[slug]/disbursements exposes it publicly (ticket 22; PRD FFI-07a). */
interface UsageReportSummary {
  id: string;
  narrative: string;
  lineItems: Array<{ label: string; amount: number }>;
  beneficiaryCount: number;
  photos: string[];
  createdAt: string;
  /** Set together, by an Admin (CONTEXT.md, Usage Report): "dipertanyakan", public beside the report. */
  disputedAt: string | null;
  disputedReason: string | null;
}

interface Disbursement {
  id: string;
  amount: number;
  description: string;
  proofImage: string | null;
  createdAt: string;
  /** Null until the Fundraiser sends one -- CONTEXT.md, Usage Report. */
  usageReport: UsageReportSummary | null;
}

type TabKey = 'story' | 'updates' | 'disbursements';

/**
 * CampaignDetail displays the full campaign detail page with:
 * - Full-width cover image
 * - Campaign info header (title, amounts, days, donation count)
 * - Tab navigation: Story, Kabar Terbaru, Pencairan Dana
 * - Tab content with campaign story, updates, and disbursements
 * - Creator info section
 * - Fixed bottom donate/share buttons
 */
export function CampaignDetail({ campaign, onDonate, onShare }: CampaignDetailProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('story');
  const [updates, setUpdates] = useState<CampaignUpdate[]>([]);
  const [disbursements, setDisbursements] = useState<Disbursement[]>([]);
  const [isLoadingUpdates, setIsLoadingUpdates] = useState(false);
  const [isLoadingDisbursements, setIsLoadingDisbursements] = useState(false);

  const remainingDays = campaign.deadline
    ? getRemainingDays(new Date(campaign.deadline))
    : null;

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'story', label: 'Story' },
    { key: 'updates', label: 'Kabar Terbaru' },
    { key: 'disbursements', label: 'Pencairan Dana' },
  ];

  // Fetch updates when tab is activated
  useEffect(() => {
    if (activeTab === 'updates' && updates.length === 0) {
      setIsLoadingUpdates(true);
      fetch(`/api/campaigns/${campaign.slug}/updates`)
        .then((res) => res.json())
        .then((data) => {
          setUpdates(data.updates || data || []);
        })
        .catch(() => {
          setUpdates([]);
        })
        .finally(() => {
          setIsLoadingUpdates(false);
        });
    }
  }, [activeTab, campaign.slug, updates.length]);

  // Fetch disbursements when tab is activated
  useEffect(() => {
    if (activeTab === 'disbursements' && disbursements.length === 0) {
      setIsLoadingDisbursements(true);
      fetch(`/api/campaigns/${campaign.slug}/disbursements`)
        .then((res) => res.json())
        .then((data) => {
          setDisbursements(data.disbursements || data || []);
        })
        .catch(() => {
          setDisbursements([]);
        })
        .finally(() => {
          setIsLoadingDisbursements(false);
        });
    }
  }, [activeTab, campaign.slug, disbursements.length]);

  return (
    <div className="pb-20">
      {/* Full-width cover image */}
      <div className="relative w-full aspect-video">
        <LazyImage
          src={campaign.coverImage}
          alt={campaign.title}
          width={1200}
          height={675}
          priority={true}
          className="w-full h-full"
        />
        {campaign.isUrgent && (
          <span className="absolute top-3 left-3 bg-danger text-white text-xs font-semibold px-2 py-1 rounded">
            DARURAT
          </span>
        )}
      </div>

      {/* Campaign Info Header */}
      <div className="px-4 py-4">
        <CampaignStatusBanner
          status={campaign.lifecycleStatus}
          suspensionReason={campaign.suspensionReason}
        />
        <h1 className="text-lg font-bold text-text leading-snug mb-2">
          {campaign.title}
        </h1>

        {/* Creator name */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-sm text-text-secondary">{campaign.creator.name}</span>
        </div>

        {/* Progress Bar */}
        <div className="mb-3">
          <ProgressBar
            current={campaign.collectedAmount}
            target={campaign.targetAmount}
            size="md"
            animated={true}
          />
        </div>

        {/* Amounts and stats */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-base font-bold text-text">
              {formatRupiah(campaign.collectedAmount)}
            </p>
            <p className="text-xs text-text-secondary">
              terkumpul dari {formatRupiah(campaign.targetAmount)}
            </p>
          </div>
        </div>

        {/* Donation count and days remaining */}
        <div className="flex items-center gap-4 text-sm text-text-secondary">
          <div className="flex items-center gap-1">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>
              <strong className="text-text">{campaign.donationCount.toLocaleString('id-ID')}</strong> Donasi
            </span>
          </div>
          {remainingDays !== null && remainingDays > 0 && (
            <div className="flex items-center gap-1">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>
                <strong className="text-text">{remainingDays}</strong> hari lagi
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-border">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-3 text-sm font-medium text-center transition-colors relative ${
                activeTab === tab.key
                  ? 'text-primary'
                  : 'text-text-secondary hover:text-text'
              }`}
              aria-selected={activeTab === tab.key}
              role="tab"
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="px-4 py-4">
        {activeTab === 'story' && (
          <CampaignStory story={campaign.story} />
        )}
        {activeTab === 'updates' && (
          <CampaignUpdates updates={updates} isLoading={isLoadingUpdates} />
        )}
        {activeTab === 'disbursements' && (
          <CampaignDisbursements
            disbursements={disbursements}
            isLoading={isLoadingDisbursements}
          />
        )}
      </div>

      {/* Creator Info Section */}
      <div className="px-4 py-4 border-t border-border">
        <h3 className="text-sm font-semibold text-text mb-3">Penggalang Dana</h3>
        <div className="flex items-center gap-3">
          {campaign.creator.avatar ? (
            <img
              src={campaign.creator.avatar}
              alt={campaign.creator.name}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-gray-400"
                aria-hidden="true"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
          )}
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-text">
                {campaign.creator.name}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Fixed Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border px-4 py-3 flex items-center gap-3 z-50">
        <button
          onClick={onShare}
          className="p-3 border border-border rounded-lg hover:bg-gray-50 transition-colors"
          aria-label="Bagikan campaign"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
        </button>
        {offersDonating(campaign.lifecycleStatus) && (
          <button
            onClick={onDonate}
            className="flex-1 bg-primary hover:bg-primary-dark text-white font-semibold py-3 rounded-lg transition-colors text-sm"
          >
            Donasi sekarang
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * CampaignStory renders the campaign's story HTML content safely.
 */
function CampaignStory({ story }: { story: string }) {
  return (
    <div
      className="prose prose-sm max-w-none text-text leading-relaxed"
      dangerouslySetInnerHTML={{ __html: story }}
    />
  );
}

/**
 * CampaignUpdates displays the list of campaign updates with timestamps and images.
 */
function CampaignUpdates({
  updates,
  isLoading,
}: {
  updates: CampaignUpdate[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-200 rounded w-1/2 mb-2" />
            <div className="h-20 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (updates.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-text-secondary">Belum ada kabar terbaru</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {updates.map((update) => {
        const date = new Date(update.createdAt);
        const formattedDate = date.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });

        return (
          <article key={update.id} className="border-b border-border pb-4 last:border-b-0">
            <p className="text-xs text-text-secondary mb-1">{formattedDate}</p>
            <h4 className="text-sm font-semibold text-text mb-2">{update.title}</h4>
            <div
              className="text-sm text-text-secondary leading-relaxed"
              dangerouslySetInnerHTML={{ __html: update.content }}
            />
            {update.images && update.images.length > 0 && (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {update.images.map((img, idx) => (
                  <img
                    key={idx}
                    src={img}
                    alt={`Update image ${idx + 1}`}
                    className="w-32 h-24 object-cover rounded-lg flex-shrink-0"
                  />
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

/**
 * CampaignDisbursements displays fund disbursement records.
 */
function CampaignDisbursements({
  disbursements,
  isLoading,
}: {
  disbursements: Disbursement[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
            <div className="h-3 bg-gray-200 rounded w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  if (disbursements.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-text-secondary">Belum ada pencairan dana</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {disbursements.map((record) => {
        const date = new Date(record.createdAt);
        const formattedDate = date.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });

        return (
          <div key={record.id} className="border-b border-border pb-4 last:border-b-0">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold text-text">
                {formatRupiah(record.amount)}
              </p>
              <p className="text-xs text-text-secondary">{formattedDate}</p>
            </div>
            <p className="text-sm text-text-secondary">{record.description}</p>
            {record.proofImage && (
              <img
                src={record.proofImage}
                alt="Bukti pencairan"
                className="mt-2 w-full max-h-40 object-cover rounded-lg"
              />
            )}
            <UsageReportSection usageReport={record.usageReport} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * A Usage Report on one Payout (ticket 22; PRD FFI-07a; CONTEXT.md, Usage
 * Report): "tampil publik di halaman Campaign", shown right below the Payout
 * it accounts for, sejak dikirim -- no review state to wait through.
 *
 * Says explicitly when none has been sent yet, rather than rendering
 * nothing: a Payout without a Usage Report is exactly the fact this ticket's
 * gate exists to fix, and a silent gap here would read as a missing feature
 * rather than as a Fundraiser who has not reported yet.
 */
function UsageReportSection({ usageReport }: { usageReport: UsageReportSummary | null }) {
  if (!usageReport) {
    return (
      <p className="mt-2 text-xs text-text-secondary italic">
        Usage Report belum dikirim untuk pencairan ini.
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-gray-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-text">Usage Report</p>
        {usageReport.disputedAt && (
          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
            Dipertanyakan
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-text-secondary">{usageReport.narrative}</p>
      <ul className="mt-2 space-y-0.5">
        {usageReport.lineItems.map((item, idx) => (
          <li key={idx} className="flex justify-between text-xs text-text-secondary">
            <span>{item.label}</span>
            <span className="font-medium text-text">{formatRupiah(item.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-text-secondary">{usageReport.beneficiaryCount} penerima manfaat</p>
      {usageReport.photos.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {usageReport.photos.map((photo, idx) => (
            <img
              key={idx}
              src={photo}
              alt={`Foto bukti pemakaian dana ${idx + 1}`}
              className="w-24 h-20 object-cover rounded-lg flex-shrink-0"
            />
          ))}
        </div>
      )}
      {usageReport.disputedReason && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {usageReport.disputedReason}
        </p>
      )}
    </div>
  );
}

export default CampaignDetail;
