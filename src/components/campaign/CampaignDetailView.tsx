'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { formatRupiah } from '@/lib/utils/currency';
import { getRemainingDays } from '@/lib/utils/date';
import { offersDonating } from '@/lib/campaign-page-status';
import { useSuspensionReason } from '@/lib/hooks/useSuspensionReason';
import { useWithdrawableSubmission } from '@/lib/hooks/useWithdrawableSubmission';
import { useTrafficSources } from '@/lib/hooks/useTrafficSources';
import { captureTrafficSource } from '@/lib/traffic-source-capture';
import type { CampaignLifecycleStatus } from '@/types/campaign';
import { formatFeePercent } from '@/lib/money/platform-fee';
import { CampaignStatusBanner } from './CampaignStatusBanner';

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
  /** Effective status: an Active Campaign past its deadline arrives as EXPIRED. */
  lifecycleStatus: CampaignLifecycleStatus;
  isUrgent: boolean;
  /** Sample content (task M9) -- the badge below is additional, not the refusal mechanism; POST /api/donations refuses it regardless. */
  isDemo: boolean;
  deadline: string | null;
  createdAt: string;
  creator: {
    id: string;
    name: string;
    avatar: string | null;
  };
  donationCount: number;
  /** The Platform Fee rate in force for this Campaign right now, in basis
   * points (CONTEXT.md, Platform Fee; prd-compliance 17) -- resolved
   * server-side per Campaign, then per Category, then per Kind default. */
  platformFeePercentBps: number;
  /** The Escrow Hold length every new Payment freezes at creation
   * (CONTEXT.md, Escrow Hold; prd-compliance 18). */
  escrowHoldDays: number;
}

interface CampaignDetailViewProps {
  campaign: CampaignDetailData;
}

/** A Payout's Usage Report, as GET /api/campaigns/[slug]/disbursements exposes it publicly (ticket 22; PRD FFI-07a). */
interface UsageReportSummary {
  id: string;
  narrative: string;
  lineItems: Array<{ label: string; amount: number }>;
  beneficiaryCount: number;
  photos: string[];
  /** Set together, by an Admin (CONTEXT.md, Usage Report): "dipertanyakan", public beside the report. */
  disputedAt: string | null;
  disputedReason: string | null;
}

/**
 * Only http(s) is a photo anyone can host as public evidence -- a
 * `javascript:` URL is a link that would run when a public visitor clicks it,
 * and `data:` is not evidence of anything hosted at all. The service layer
 * (@/lib/usage-reports.ts) already refuses either at submission time; this is
 * a second, independent check at render time so a row written before that
 * rule existed, or by any other path, is never turned into a clickable link.
 */
function isPublicPhotoUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

interface DisbursementRow {
  id: string;
  amount: number;
  description: string;
  proofImage: string | null;
  createdAt: string;
  usageReport: UsageReportSummary | null;
}

/**
 * A COMPLETED Payout and its Usage Report -- or the fact that none has been
 * sent yet (ticket 22; PRD FFI-07a; CONTEXT.md, Usage Report). "tampil
 * publik di halaman Campaign" is THIS page (src/app/campaign/[slug]/page.tsx
 * renders CampaignDetailView, not CampaignDetail.tsx, which nothing in the
 * app links to), so this is where the requirement has to actually be
 * reachable, under the Pencairan Dana tab below.
 */
function DisbursementsTab({ slug }: { slug: string }) {
  const [rows, setRows] = useState<DisbursementRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${slug}/disbursements`)
      .then((res) => (res.ok ? res.json() : { disbursements: [] }))
      .then((data) => {
        if (!cancelled) setRows(Array.isArray(data?.disbursements) ? data.disbursements : []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (rows === null) {
    return <p className="text-sm text-text-secondary">Memuat data pencairan...</p>;
  }

  if (rows.length === 0) {
    return <p className="text-sm text-text-secondary">Belum ada pencairan dana untuk campaign ini.</p>;
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.id} className="border-b border-border pb-4 last:border-b-0">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-text">{formatRupiah(row.amount)}</p>
          </div>
          <p className="text-sm text-text-secondary">{row.description}</p>

          {row.usageReport ? (
            <div className="mt-3 rounded-lg border border-border bg-gray-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-text">Usage Report</p>
                {row.usageReport.disputedAt && (
                  <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
                    Dipertanyakan
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-text-secondary">{row.usageReport.narrative}</p>
              <ul className="mt-2 space-y-0.5">
                {row.usageReport.lineItems.map((item, idx) => (
                  <li key={idx} className="flex justify-between text-xs text-text-secondary">
                    <span>{item.label}</span>
                    <span className="font-medium text-text">{formatRupiah(item.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-text-secondary">{row.usageReport.beneficiaryCount} penerima manfaat</p>
              {row.usageReport.photos.filter(isPublicPhotoUrl).length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {row.usageReport.photos.filter(isPublicPhotoUrl).map((photo, idx) => (
                    <li key={photo}>
                      <a
                        href={photo}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block h-16 w-16 overflow-hidden rounded-lg border border-border"
                      >
                        {/* Fundraiser-supplied URL, so a plain <img>, not next/image -- the
                            same choice CampaignUpdate's own images already make. */}
                        <img
                          src={photo}
                          alt={`Foto bukti ${idx + 1}`}
                          className="h-full w-full object-cover"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {row.usageReport.disputedReason && (
                <p role="alert" className="mt-2 text-xs text-danger">
                  {row.usageReport.disputedReason}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-text-secondary italic">
              Usage Report belum dikirim untuk pencairan ini.
            </p>
          )}
        </div>
      ))}
    </div>
  );
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
  // Its own state, seeded from the prop, not just the prop itself: a
  // Fundraiser who withdraws their pending submission here
  // (verification-request 10) must see the Campaign's new status (Draft or
  // Rejected) without a page reload. `campaign` never changes identity
  // once this view is mounted (its caller renders it once per lookup), so
  // this is initial state, not state to keep synced with the prop.
  const [lifecycleStatus, setLifecycleStatus] = useState(campaign.lifecycleStatus);
  // Ticket 22: which of the (so far) two live tabs is shown. "Kabar Terbaru"
  // stays a plain, unwired button, exactly as all three were before this
  // ticket -- adding it is a separate concern this ticket does not touch.
  const [activeTab, setActiveTab] = useState<'story' | 'disbursements'>('story');

  const suspensionReason = useSuspensionReason(campaign.slug, lifecycleStatus);
  const withdrawal = useWithdrawableSubmission(campaign.slug, lifecycleStatus, setLifecycleStatus);
  // Traffic Source (ticket 24): captured once on arrival, from whatever
  // `src` this exact page load's URL carries -- before it is lost the
  // moment the visitor navigates on to /donate. trafficSources stays null
  // for anyone but this Campaign's own Fundraiser or an Admin (the API
  // refuses everyone else), so the panel below renders nothing for a donor.
  useEffect(() => {
    captureTrafficSource(campaign.slug, window.location.href);
  }, [campaign.slug]);
  const trafficSources = useTrafficSources(campaign.slug);

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

          <CampaignStatusBanner
            status={lifecycleStatus}
            suspensionReason={suspensionReason}
          />

          {/* "Tarik pengajuan": while the Campaign is Submitted, the
              owning Fundraiser may withdraw the Verification Request it
              waits on (verification-request 10). GET
              /api/campaigns/[slug] withholds `pendingVerificationRequestId`
              from anyone else, so nobody else ever sees this button. */}
          {typeof withdrawal.requestId === 'string' && (
            <div className="mb-3">
              {withdrawal.refusal && (
                <p className="text-xs text-danger mb-1">{withdrawal.refusal}</p>
              )}
              <button
                type="button"
                onClick={withdrawal.withdraw}
                disabled={withdrawal.pending}
                className="w-full text-xs font-medium px-3 py-2 rounded-lg border border-primary text-primary hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Tarik pengajuan
              </button>
            </div>
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

            {/* Platform Fee rate in force (prd-compliance 17, CONTEXT.md:
                "ditampilkan terbuka di halaman Campaign") */}
            <p className="text-xs text-text-secondary">
              Platform Fee: <span className="font-medium text-text">{formatFeePercent(campaign.platformFeePercentBps)}</span>
            </p>

            {/* Escrow Hold length every new Payment freezes at creation
                (prd-compliance 18, CONTEXT.md: "ditampilkan di halaman
                Campaign") */}
            <p className="text-xs text-text-secondary">
              Masa tahan dana: <span className="font-medium text-text">{campaign.escrowHoldDays} hari</span>
            </p>

            {/* Traffic Source counts (ticket 24, "Counts per link are
                visible to the Fundraiser"): trafficSources stays null for
                anyone the API refused, which includes every non-owner
                viewer, so this renders nothing for them. */}
            {trafficSources && trafficSources.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs font-semibold text-text-secondary mb-1">
                  Sumber Kunjungan
                </p>
                <ul className="space-y-0.5">
                  {trafficSources.map((row) => (
                    <li
                      key={row.source ?? '(tidak diketahui)'}
                      className="flex justify-between text-xs text-text-secondary"
                    >
                      <span>{row.source ?? 'Langsung / tidak diketahui'}</span>
                      <span className="font-medium text-text">{row.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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

        {/* Tab navigation. Only Cerita and Pencairan Dana are wired (ticket
            22): Kabar Terbaru stays a plain button, as all three were
            before this ticket -- wiring it is a separate concern. */}
        <div className="flex gap-4 border-b border-border mb-4">
          <button
            onClick={() => setActiveTab('story')}
            className={
              activeTab === 'story'
                ? 'pb-2 text-sm font-medium text-primary border-b-2 border-primary'
                : 'pb-2 text-sm font-medium text-text-secondary hover:text-text transition-colors'
            }
          >
            Cerita
          </button>
          <button className="pb-2 text-sm font-medium text-text-secondary hover:text-text transition-colors">
            Kabar Terbaru
          </button>
          <button
            onClick={() => setActiveTab('disbursements')}
            className={
              activeTab === 'disbursements'
                ? 'pb-2 text-sm font-medium text-primary border-b-2 border-primary'
                : 'pb-2 text-sm font-medium text-text-secondary hover:text-text transition-colors'
            }
          >
            Pencairan Dana
          </button>
        </div>

        {activeTab === 'story' ? (
          <div
            className="prose prose-sm max-w-none text-text leading-relaxed
              prose-headings:text-text prose-headings:font-semibold
              prose-p:text-text prose-p:leading-relaxed
              prose-img:rounded-lg prose-img:my-4
              prose-a:text-primary prose-a:no-underline hover:prose-a:underline"
            dangerouslySetInnerHTML={{ __html: campaign.story }}
          />
        ) : (
          <DisbursementsTab slug={campaign.slug} />
        )}
      </div>

      {/* Fixed bottom CTA -- already visible on every viewport regardless of
          scroll position (position: fixed), so this alone already satisfies
          "donate button visible without scrolling" on desktop too; no
          separate desktop-specific button is added (see this task's Design
          decision above). Offered only while the Campaign is effectively
          Active; any other status has its banner above instead. */}
      {offersDonating(lifecycleStatus) && (
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
      )}
    </div>
  );
}

export default CampaignDetailView;
