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
import { SUBMITTABLE_STATUSES, submitToVerifier, withdrawFromVerifier } from '@/lib/verification-submission';
import { PAYOUT_REQUESTABLE_STATUSES } from '@/lib/payout-requestable-statuses';

interface Campaign {
  id: string;
  slug: string;
  title: string;
  coverImage: string;
  collectedAmount: number;
  targetAmount: number;
  /** Effective: an Active Campaign past its deadline arrives as EXPIRED. */
  lifecycleStatus: CampaignLifecycleStatus;
  /** The Verification Request a Submitted Campaign waits on, which its Fundraiser may withdraw. */
  pendingVerificationRequestId: string | null;
  createdAt: string;
}

interface CampaignsResponse {
  campaigns: Campaign[];
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
      <div className="min-h-screen bg-[#F5F5F5] pb-20">
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
          <div className="w-20 h-20 bg-[#E0E0E0] rounded-full flex items-center justify-center mb-4">
            <svg className="w-10 h-10 text-[#757575]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <p className="text-[#757575] text-center text-sm mb-4">
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
    <div className="min-h-screen bg-[#F5F5F5] pb-20">
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
              className="bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
            >
              <Link href={`/campaign/${campaign.slug}`} className="block">
                <div className="flex">
                  {/* Cover Image */}
                  <div className="w-28 h-28 flex-shrink-0 relative bg-[#E0E0E0]">
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
                        <svg className="w-8 h-8 text-[#757575]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-3 flex flex-col justify-between min-w-0">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-[#212121] text-sm font-medium line-clamp-2 flex-1">
                          {campaign.title}
                        </h3>
                        <CampaignStatusBadge status={campaign.lifecycleStatus} />
                      </div>
                    </div>

                    <div className="mt-2">
                      {/* Progress Bar */}
                      <div className="w-full bg-[#E0E0E0] rounded-full h-1.5 mb-1.5">
                        <div
                          className="bg-[#0073E6] h-1.5 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>

                      {/* Amount Info */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[#212121] text-xs font-semibold">
                            {formatRupiah(campaign.collectedAmount)}
                          </p>
                          <p className="text-[#757575] text-[10px]">
                            dari {formatRupiah(campaign.targetAmount)}
                          </p>
                        </div>
                        <p className="text-[#757575] text-xs font-medium">
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
                  className="border-t border-[#E0E0E0] px-3 py-2 text-xs font-medium text-[#0073E6] hover:bg-[#F5F5F5] transition-colors"
                >
                  Cairkan dana
                </Link>
              )}
              {SUBMITTABLE_STATUSES.includes(campaign.lifecycleStatus) && (
                <VerificationAction
                  label="Ajukan ke Verifier"
                  variant="primary"
                  run={() => submitToVerifier(campaign.slug)}
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
              className="px-3 py-1.5 text-sm rounded-lg border border-[#E0E0E0] bg-white text-[#212121] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#F5F5F5] transition-colors"
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
                  <span key={`ellipsis-${idx}`} className="px-2 text-[#757575] text-sm">
                    ...
                  </span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setPage(item)}
                    className={`w-8 h-8 text-sm rounded-lg transition-colors ${
                      page === item
                        ? 'bg-[#0073E6] text-white font-medium'
                        : 'border border-[#E0E0E0] bg-white text-[#212121] hover:bg-[#F5F5F5]'
                    }`}
                  >
                    {item}
                  </button>
                )
              )}

            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm rounded-lg border border-[#E0E0E0] bg-white text-[#212121] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#F5F5F5] transition-colors"
            >
              Selanjutnya
            </button>
          </div>

          {/* Page info */}
          <p className="text-center text-[#757575] text-xs mt-2">
            Halaman {page} dari {totalPages} ({total} kampanye)
          </p>
        </div>
      )}
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
}: {
  label: string;
  run: () => Promise<string | null>;
  onDone: () => void;
  variant: 'primary' | 'secondary';
}) {
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState('');

  async function act() {
    setPending(true);
    setRefusal('');
    const refused = await run();
    setPending(false);
    if (refused) setRefusal(refused);
    else onDone();
  }

  const look =
    variant === 'primary'
      ? 'text-white bg-[#0073E6] hover:bg-[#005BB5]'
      : 'text-[#0073E6] bg-white border border-[#0073E6] hover:bg-[#F5F5F5]';

  return (
    <div className="border-t border-[#E0E0E0] px-3 py-2 flex items-center justify-between gap-2">
      <p className="text-xs text-danger">{refusal}</p>
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
    <div className="min-h-screen bg-[#F5F5F5] pb-20">
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
          <div key={i} className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="flex">
              <div className="w-28 h-28 bg-[#E0E0E0] animate-pulse flex-shrink-0" />
              <div className="flex-1 p-3 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="h-4 w-3/4 bg-[#E0E0E0] rounded animate-pulse" />
                  <div className="h-5 w-12 bg-[#E0E0E0] rounded-full animate-pulse" />
                </div>
                <div className="space-y-1.5">
                  <div className="h-1.5 w-full bg-[#E0E0E0] rounded-full animate-pulse" />
                  <div className="flex justify-between">
                    <div className="h-3 w-20 bg-[#E0E0E0] rounded animate-pulse" />
                    <div className="h-3 w-8 bg-[#E0E0E0] rounded animate-pulse" />
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
