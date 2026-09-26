'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { formatRupiah } from '@/lib/utils/currency';
import { formatIndonesianDate } from '@/lib/utils/date';

interface DonationItem {
  id: string;
  amount: number;
  paymentMethod: string;
  paymentStatus: 'pending' | 'confirmed' | 'failed';
  isAnonymous: boolean;
  message: string | null;
  createdAt: string;
  campaign: {
    title: string;
    slug: string;
    coverImage: string;
  };
}

interface DonationsResponse {
  donations: DonationItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function DonasiSayaPage() {
  const { status } = useSession();
  const router = useRouter();
  const [donations, setDonations] = useState<DonationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  const fetchDonations = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch('/api/donations/mine');
      if (!res.ok) {
        throw new Error('Gagal memuat data donasi');
      }
      const data: DonationsResponse = await res.json();
      setDonations(data.donations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchDonations();
    }
  }, [status, fetchDonations]);

  if (status === 'loading') {
    return <DonasiSayaSkeleton />;
  }

  if (status === 'unauthenticated') {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-20">
      {/* Header */}
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <h1 className="text-white text-lg font-semibold">Donasi Saya</h1>
      </div>

      {/* Content */}
      <div className="px-4 mt-4">
        {isLoading ? (
          <DonationListSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchDonations} />
        ) : donations.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {donations.map((donation) => (
              <DonationCard
                key={donation.id}
                donation={donation}
                onClick={() => router.push(`/campaign/${donation.campaign.slug}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DonationCard({
  donation,
  onClick,
}: {
  donation: DonationItem;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-white rounded-xl shadow-sm p-4 text-left hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[#212121] text-sm font-semibold line-clamp-2">
            {donation.campaign.title}
          </p>
          <p className="text-[#757575] text-xs mt-1">
            {formatIndonesianDate(new Date(donation.createdAt))}
          </p>
        </div>
        <PaymentStatusBadge status={donation.paymentStatus} />
      </div>
      <div className="mt-3 pt-3 border-t border-[#E0E0E0]">
        <p className="text-[#0073E6] text-sm font-bold">
          {formatRupiah(donation.amount)}
        </p>
      </div>
    </button>
  );
}

function PaymentStatusBadge({ status }: { status: 'pending' | 'confirmed' | 'failed' }) {
  const config = {
    pending: {
      label: 'Menunggu',
      bg: 'bg-[#FFF8E1]',
      text: 'text-[#F57F17]',
    },
    confirmed: {
      label: 'Berhasil',
      bg: 'bg-[#E8F5E9]',
      text: 'text-[#2E7D32]',
    },
    failed: {
      label: 'Gagal',
      bg: 'bg-[#FFEBEE]',
      text: 'text-[#C62828]',
    },
  };

  const { label, bg, text } = config[status];

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${text} flex-shrink-0`}
    >
      {label}
    </span>
  );
}

function EmptyState() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      {/* Empty state icon */}
      <div className="w-20 h-20 rounded-full bg-[#E3F2FD] flex items-center justify-center mb-4">
        <svg
          className="w-10 h-10 text-[#0073E6]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
          />
        </svg>
      </div>
      <p className="text-[#212121] text-base font-semibold text-center">
        Anda belum pernah berdonasi
      </p>
      <p className="text-[#757575] text-sm text-center mt-1">
        Mulai berbagi kebaikan dengan berdonasi
      </p>
      <button
        onClick={() => router.push('/explore/all')}
        className="mt-6 bg-[#0073E6] text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-[#005BB5] transition-colors"
      >
        Mulai Berdonasi
      </button>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-16 h-16 rounded-full bg-[#FFEBEE] flex items-center justify-center mb-4">
        <svg
          className="w-8 h-8 text-[#D50000]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <p className="text-[#212121] text-sm text-center">{message}</p>
      <button
        onClick={onRetry}
        className="mt-4 text-[#0073E6] text-sm font-medium hover:underline"
      >
        Coba Lagi
      </button>
    </div>
  );
}

function DonasiSayaSkeleton() {
  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-20">
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <div className="h-5 w-24 bg-white/20 rounded" />
      </div>
      <div className="px-4 mt-4">
        <DonationListSkeleton />
      </div>
    </div>
  );
}

function DonationListSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 bg-[#E0E0E0] rounded animate-pulse" />
              <div className="h-3 w-24 bg-[#E0E0E0] rounded animate-pulse" />
            </div>
            <div className="h-5 w-16 bg-[#E0E0E0] rounded-full animate-pulse" />
          </div>
          <div className="mt-3 pt-3 border-t border-[#E0E0E0]">
            <div className="h-4 w-28 bg-[#E0E0E0] rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
