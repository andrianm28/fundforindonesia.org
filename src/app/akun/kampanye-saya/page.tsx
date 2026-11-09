'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import useSWR from 'swr';
import { formatRupiah } from '@/lib/utils/currency';
import { CampaignStatusBadge } from '@/components/campaign/CampaignStatusBadge';
import type { CampaignLifecycleStatus } from '@/types/campaign';
import { SUBMITTABLE_STATUSES, submitToVerifier, TRUTH_STATEMENT_REQUIRED, withdrawFromVerifier } from '@/lib/verification-submission';
import { TruthStatementField } from '@/components/campaign/TruthStatementField';
import { PAYOUT_REQUESTABLE_STATUSES } from '@/lib/payout-requestable-statuses';
import { DOCUMENT_UPLOADABLE_STATUSES } from '@/lib/document-uploadable-statuses';

interface Campaign {
  id: string;
  slug: string;
  title: string;
  coverImage: string;
  collectedAmount: number;
  targetAmount: number;
  /** Effective: an Active Campaign past its deadline arrives as EXPIRED. */
  lifecycleStatus: CampaignLifecycleStatus;
  /** The Verifier rejected it for good: it reads "Ditolak" and cannot be edited or submitted again (PKS pasal 3.4). */
  rejectionFinal?: boolean;
  /** The Verification Request a Submitted Campaign waits on, which its Fundraiser may withdraw. */
  pendingVerificationRequestId: string | null;
  createdAt: string;
}

interface IncomeSummary {
  total: number;
  perCampaign: Array<{ campaignId: string; slug: string; title: string; totalAmount: number; donationCount: number }>;
}

interface CampaignsResponse {
  campaigns: Campaign[];
  /** Settled Donations only, over all of the Fundraiser's Campaigns (PKS 3.9). */
  income?: IncomeSummary;
  total: number;
  page: number;
  totalPages: number;
}

const fetcher = (url: string) => fetch(url).then((res) => {
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
});

export default function MyCampaignsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  const { data, isLoading, error, mutate } = useSWR<CampaignsResponse>(
    status === 'authenticated' ? `/api/user/campaigns?page=${page}&limit=10` : null,
    fetcher
  );

  if (status === 'loading' || (status === 'authenticated' && isLoading)) {
    return <CampaignsSkeleton />;
  }

  if (status === 'unauthenticated') {
    return null;
  }

  const campaigns = data?.campaigns ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  // Empty state
  if (!isLoading && campaigns.length === 0 && page === 1) {
    return (
      <div className="min-h-screen bg-bg-secondary pb-20">
        {/* Header */}
        <div className="bg-[#0073E6] px-4 pt-8 pb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="text-white"
              aria-label="Kembali"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-white text-lg font-semibold">Galang Dana Saya</h1>
          </div>
        </div>

        {/* Empty State */}
        <div className="flex flex-col items-center justify-center px-6 py-16">
          <div className="w-20 h-20 bg-border rounded-full flex items-center justify-center mb-4">
            <svg className="w-10 h-10 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <p className="text-text-secondary text-center text-sm mb-4">
            Anda belum membuat kampanye galang dana
          </p>
          <Link
            href="/campaign/create"
            className="bg-[#0073E6] text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-[#005BB5] transition-colors"
          >
            Buat Kampanye
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-secondary pb-20">
      {/* Header */}
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-white"
            aria-label="Kembali"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-white text-lg font-semibold">Galang Dana Saya</h1>
        </div>
      </div>

      {data?.income && <IncomeSummaryCard income={data.income} />}

      {/* Campaign List */}
      <div className="px-4 mt-4 space-y-3">
        {campaigns.map((campaign) => {
          const pendingRequestId = campaign.pendingVerificationRequestId;
          const progress = campaign.targetAmount > 0
            ? Math.min(100, Math.round((campaign.collectedAmount / campaign.targetAmount) * 100))
            : 0;

          return (
            <div
              key={campaign.id}
              data-testid={`campaign-${campaign.slug}`}
              className="bg-white rounded-xl shadow-xs overflow-hidden hover:shadow-md transition-shadow"
            >
              <Link href={`/campaign/${campaign.slug}`} className="block">
                <div className="flex">
                  {/* Cover Image */}
                  <div className="w-28 h-28 shrink-0 relative bg-border">
                    {campaign.coverImage ? (
                      <Image
                        src={campaign.coverImage}
                        alt={campaign.title}
                        fill
                        className="object-cover"
                        sizes="112px"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-3 flex flex-col justify-between min-w-0">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-text text-sm font-medium line-clamp-2 flex-1">
                          {campaign.title}
                        </h3>
                        <CampaignStatusBadge status={campaign.lifecycleStatus} rejectionFinal={campaign.rejectionFinal} />
                      </div>
                    </div>

                    <div className="mt-2">
                      {/* Progress Bar */}
                      <div className="w-full bg-border rounded-full h-1.5 mb-1.5">
                        <div
                          className="bg-[#0073E6] h-1.5 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>

                      {/* Amount Info */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-text text-xs font-semibold">
                            {formatRupiah(campaign.collectedAmount)}
                          </p>
                          <p className="text-text-secondary text-[10px]">
                            dari {formatRupiah(campaign.targetAmount)}
                          </p>
                        </div>
                        <p className="text-text-secondary text-xs font-medium">
                          {progress}%
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
              {/*
                The way to the Payout screen. A Payout may only be requested in
                Active, Expired or Completed, so the link is not shown for the
                statuses that would refuse one -- the request is refused under
                the subject guard either way, but offering a button that always
                turns into a refusal teaches the Fundraiser that the screen is
                broken.
              */}
              {PAYOUT_REQUESTABLE_STATUSES.includes(campaign.lifecycleStatus) && (
                <Link
                  href={`/akun/kampanye-saya/${campaign.slug}/pencairan`}
                  className="border-t border-border px-3 py-2 text-xs font-medium text-[#0073E6] hover:bg-bg-secondary transition-colors"
                >
                  Cairkan dana
                </Link>
              )}
              {/*
                The Fundraiser's own manage screen (ticket 72): editing a Draft
                or Rejected Campaign, or asking for a new target or deadline on
                an Active one (change, complete, cancel). Other statuses have nothing to change there.
              */}
              {SUBMITTABLE_STATUSES.includes(campaign.lifecycleStatus) && !campaign.rejectionFinal && (
                <Link
                  href={`/akun/kampanye-saya/${campaign.slug}`}
                  className="border-t border-border px-3 py-2 text-xs font-medium text-[#0073E6] hover:bg-bg-secondary transition-colors"
                >
                  Edit
                </Link>
              )}
              {campaign.lifecycleStatus === 'ACTIVE' && (
                <Link
                  href={`/akun/kampanye-saya/${campaign.slug}`}
                  className="border-t border-border px-3 py-2 text-xs font-medium text-[#0073E6] hover:bg-bg-secondary transition-colors"
                >
                  Kelola
                </Link>
              )}
              {/* Kabar Terbaru is public, so only once the Campaign is approved. */}
              {['ACTIVE', 'SUSPENDED', 'EXPIRED', 'COMPLETED'].includes(campaign.lifecycleStatus) && (
                <Link
                  href={`/akun/kampanye-saya/${campaign.slug}/kabar`}
                  className="border-t border-border px-3 py-2 text-xs font-medium text-[#0073E6] hover:bg-bg-secondary transition-colors"
                >
                  Tulis kabar
                </Link>
              )}
              {/* The private papers a Verifier checks (ticket 64, PRD §7.1). */}
              {DOCUMENT_UPLOADABLE_STATUSES.includes(campaign.lifecycleStatus) && (
                <Link
                  href={`/akun/kampanye-saya/${campaign.slug}/dokumen`}
                  className="border-t border-border px-3 py-2 text-xs font-medium text-[#0073E6] hover:bg-bg-secondary transition-colors"
                >
                  Dokumen
                </Link>
              )}
              {SUBMITTABLE_STATUSES.includes(campaign.lifecycleStatus) && !campaign.rejectionFinal && (
                <VerificationAction
                  label="Ajukan ke Verifier"
                  variant="primary"
                  needsTruthStatement
                  run={(truthStatement) => submitToVerifier(campaign.slug, truthStatement)}
                  onDone={() => mutate()}
                />
              )}
              {pendingRequestId && (
                <VerificationAction
                  label="Tarik pengajuan"
                  variant="secondary"
                  run={() => withdrawFromVerifier(campaign.slug, pendingRequestId)}
                  onDone={() => mutate()}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Error State */}
      {error && (
        <div className="px-4 mt-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
            <p className="text-red-600 text-sm">Gagal memuat kampanye. Silakan coba lagi.</p>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-4 mt-6">
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm rounded-lg border border-border bg-white text-text disabled:opacity-50 disabled:cursor-not-allowed hover:bg-bg-secondary transition-colors"
            >
              Sebelumnya
            </button>

            {/* Page Numbers */}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => {
                // Show first, last, and pages around current
                if (p === 1 || p === totalPages) return true;
                if (Math.abs(p - page) <= 1) return true;
                return false;
              })
              .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
                if (idx > 0) {
                  const prev = arr[idx - 1];
                  if (p - prev > 1) {
                    acc.push('ellipsis');
                  }
                }
                acc.push(p);
                return acc;
              }, [])
              .map((item, idx) =>
                item === 'ellipsis' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-text-secondary text-sm">
                    ...
                  </span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setPage(item)}
                    className={`w-8 h-8 text-sm rounded-lg transition-colors ${
                      page === item
                        ? 'bg-[#0073E6] text-white font-medium'
                        : 'border border-border bg-white text-text hover:bg-bg-secondary'
                    }`}
                  >
                    {item}
                  </button>
                )
              )}

            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm rounded-lg border border-border bg-white text-text disabled:opacity-50 disabled:cursor-not-allowed hover:bg-bg-secondary transition-colors"
            >
              Selanjutnya
            </button>
          </div>

          {/* Page info */}
          <p className="text-center text-text-secondary text-xs mt-2">
            Halaman {page} dari {totalPages} ({total} kampanye)
          </p>
        </div>
      )}
    </div>
  );
}

/** Money in, per Campaign and in all, from settled Donations only (PKS 3.9). */
function IncomeSummaryCard({ income }: { income: IncomeSummary }) {
  return (
    <div data-testid="income-summary" className="mx-4 mt-4 bg-white rounded-xl shadow-xs p-4">
      <p className="text-text-secondary text-xs">Total donasi masuk</p>
      <p data-testid="income-total" className="text-[#0073E6] text-lg font-bold">
        {formatRupiah(income.total)}
      </p>
      <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
        {income.perCampaign.map((c) => (
          <li key={c.campaignId} data-testid={`income-${c.slug}`} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-text line-clamp-1 min-w-0">{c.title}</span>
            <span className="shrink-0 text-text font-medium">
              {formatRupiah(c.totalAmount)} <span className="text-text-secondary font-normal">({c.donationCount} donasi)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One Verification Request action on a Campaign card: submitting a Draft or
 * Rejected Campaign to a Verifier, or withdrawing the request it waits on.
 * `run` resolves to null on success, then the list refreshes so the badge
 * shows the new status; otherwise to the refusal shown beside the button.
 */
function VerificationAction({
  label,
  run,
  onDone,
  variant,
  needsTruthStatement = false,
}: {
  label: string;
  run: (truthStatement: boolean) => Promise<string | null>;
  onDone: () => void;
  variant: 'primary' | 'secondary';
  /** Shows the "pernyataan kebenaran data" checkbox, which must be ticked to act (PKS pasal 3.3). */
  needsTruthStatement?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [truthStatement, setTruthStatement] = useState(false);

  async function act() {
    if (needsTruthStatement && !truthStatement) {
      setRefusal(TRUTH_STATEMENT_REQUIRED);
      return;
    }
    setPending(true);
    setRefusal('');
    const refused = await run(truthStatement);
    setPending(false);
    if (refused) setRefusal(refused);
    else onDone();
  }

  const look =
    variant === 'primary'
      ? 'text-white bg-[#0073E6] hover:bg-[#005BB5]'
      : 'text-[#0073E6] bg-white border border-[#0073E6] hover:bg-bg-secondary';

  return (
    <div className="border-t border-border px-3 py-2 flex items-center justify-between gap-2">
      {needsTruthStatement ? (
        <div className="min-w-0 flex-1 text-xs">
          <TruthStatementField
            checked={truthStatement}
            onChange={(checked) => {
              setTruthStatement(checked);
              if (checked) setRefusal('');
            }}
            disabled={pending}
          />
          <p className="text-danger mt-1">{refusal}</p>
        </div>
      ) : (
        <p className="text-xs text-danger">{refusal}</p>
      )}
      <button
        type="button"
        onClick={act}
        disabled={pending}
        className={`text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors ${look}`}
      >
        {label}
      </button>
    </div>
  );
}

function CampaignsSkeleton() {
  return (
    <div className="min-h-screen bg-bg-secondary pb-20">
      {/* Header skeleton */}
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-white/20 rounded" />
          <div className="h-5 w-40 bg-white/20 rounded" />
        </div>
      </div>

      {/* Campaign cards skeleton */}
      <div className="px-4 mt-4 space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl shadow-xs overflow-hidden">
            <div className="flex">
              <div className="w-28 h-28 bg-border animate-pulse shrink-0" />
              <div className="flex-1 p-3 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="h-4 w-3/4 bg-border rounded animate-pulse" />
                  <div className="h-5 w-12 bg-border rounded-full animate-pulse" />
                </div>
                <div className="space-y-1.5">
                  <div className="h-1.5 w-full bg-border rounded-full animate-pulse" />
                  <div className="flex justify-between">
                    <div className="h-3 w-20 bg-border rounded animate-pulse" />
                    <div className="h-3 w-8 bg-border rounded animate-pulse" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
