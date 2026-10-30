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
  /** Set once this Donation has a Receipt (CONTEXT.md, Receipt) -- only after Settlement. */
  receiptToken: string | null;
  /** Set once this Donation has an Akad Wakaf (CONTEXT.md, Akad Wakaf) -- only for a `wakaf` Campaign, after Settlement. */
  akadWakafToken: string | null;
}

interface DonationsResponse {
  donations: DonationItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** False until the account's email was confirmed by link; guest history appears only after (prd-compliance 23). */
  emailVerified?: boolean;
}

export default function DonasiSayaPage() {
  const { status } = useSession();
  const router = useRouter();
  const [donations, setDonations] = useState<DonationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  const fetchDonations = useCallback(async () => {
    try {
      const res = await fetch('/api/donations/mine');
      if (!res.ok) {
        throw new Error('Gagal memuat data donasi');
      }
      const data: DonationsResponse = await res.json();
      setDonations(data.donations);
      setEmailVerified(data.emailVerified !== false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // The page starts in the loading state with no error, so the first fetch has
  // nothing to reset; only a retry does (below).
  const retry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    void fetchDonations();
  }, [fetchDonations]);

  useEffect(() => {
    if (status === 'authenticated') {
      void (async () => {
        await fetchDonations();
      })();
    }
  }, [status, fetchDonations]);

  if (status === 'loading') {
    return <DonasiSayaSkeleton />;
  }

  if (status === 'unauthenticated') {
    return null;
  }

  return (
    <div className="min-h-screen bg-bg-secondary pb-20">
      {/* Header */}
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <h1 className="text-white text-lg font-semibold">Donasi Saya</h1>
      </div>

      {/* Content */}
      <div className="px-4 mt-4">
        {!isLoading && !error && !emailVerified && <VerifyEmailPrompt />}
        {isLoading ? (
          <DonationListSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={retry} />
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

/**
 * Donations given as a guest under this account's email join this list only
 * after the address is confirmed by a link sent to it (prd-compliance 23).
 */
function VerifyEmailPrompt() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  async function send() {
    setState('sending');
    try {
      const res = await fetch('/api/user/email-verification', { method: 'POST' });
      setState(res.ok ? 'sent' : 'failed');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="mb-3 rounded-xl bg-[#E3F2FD] p-4 text-sm text-text">
      <p>Pernah berdonasi sebagai tamu? Konfirmasi email akun Anda agar donasi tersebut muncul di sini.</p>
      {state === 'sent' ? (
        <p className="mt-2 font-medium text-[#2E7D32]">Periksa email Anda untuk tautan konfirmasi.</p>
      ) : (
        <button
          type="button"
          onClick={send}
          disabled={state === 'sending'}
          className="mt-2 font-medium text-[#0073E6] hover:underline disabled:opacity-60"
        >
          Kirim tautan konfirmasi
        </button>
      )}
      {state === 'failed' && (
        <p role="alert" className="mt-2 text-[#C62828]">
          Tautan belum terkirim. Coba lagi sebentar lagi.
        </p>
      )}
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
    <div className="w-full bg-white rounded-xl shadow-xs p-4 hover:shadow-md transition-shadow">
      <button onClick={onClick} className="w-full text-left" type="button">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-text text-sm font-semibold line-clamp-2">
              {donation.campaign.title}
            </p>
            <p className="text-text-secondary text-xs mt-1">
              {formatIndonesianDate(new Date(donation.createdAt))}
            </p>
          </div>
          <PaymentStatusBadge status={donation.paymentStatus} />
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[#0073E6] text-sm font-bold">
            {formatRupiah(donation.amount)}
          </p>
        </div>
      </button>
      {donation.paymentStatus === 'confirmed' && donation.receiptToken && (
        <a
          href={`/receipt/${donation.receiptToken}`}
          onClick={(e) => e.stopPropagation()}
          className="mt-2 inline-block text-[#0073E6] text-xs font-medium hover:underline"
        >
          Lihat &amp; Cetak Bukti Donasi
        </a>
      )}
      {donation.paymentStatus === 'confirmed' && <RefundRequest donation={donation} />}
      {donation.paymentStatus === 'confirmed' && donation.akadWakafToken && (
        <a
          href={`/akad-wakaf/${donation.akadWakafToken}`}
          onClick={(e) => e.stopPropagation()}
          className="mt-2 ml-3 inline-block text-[#0073E6] text-xs font-medium hover:underline"
        >
          Lihat &amp; Cetak Tanda Terima Wakaf
        </a>
      )}
    </div>
  );
}

/**
 * A Donor's own Refund request (CONTEXT.md, Refund). The button only asks:
 * the window, the Kind's limit and "before Payout" are judged by the server,
 * which answers in words that are shown here as they come. An Admin still has
 * to approve, so nothing is paid back by pressing it.
 */
function RefundRequest({ donation }: { donation: DonationItem }) {
  const [state, setState] = useState<'closed' | 'open' | 'sending' | 'done'>('closed');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setState('sending');
    setMessage(null);
    try {
      const res = await fetch(`/api/donations/${donation.id}/refund-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: donation.amount, reason }),
      });
      if (res.ok) {
        setState('done');
        return;
      }
      const data = await res.json().catch(() => null);
      setMessage(data?.error ?? 'Gagal mengajukan Refund. Coba lagi nanti.');
    } catch {
      setMessage('Gagal mengajukan Refund. Coba lagi nanti.');
    }
    setState('open');
  }

  if (state === 'done') {
    return (
      <p className="mt-2 text-xs font-medium text-[#2E7D32]">
        Permintaan Refund terkirim. Tim kami akan meninjau dan menghubungi Anda.
      </p>
    );
  }
  if (state === 'closed') {
    return (
      <button
        type="button"
        onClick={() => setState('open')}
        className="mt-2 block text-[#0073E6] text-xs font-medium hover:underline"
      >
        Ajukan Refund
      </button>
    );
  }
  return (
    <div className="mt-3 border-t border-border pt-3">
      <label className="block text-xs text-text-secondary" htmlFor={`refund-reason-${donation.id}`}>
        Alasan meminta Refund sebesar {formatRupiah(donation.amount)}
      </label>
      <textarea
        id={`refund-reason-${donation.id}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        rows={2}
        className="mt-1 w-full rounded-lg border border-border p-2 text-sm"
      />
      {message && (
        <p role="alert" className="mt-1 text-xs text-[#C62828]">
          {message}
        </p>
      )}
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={state === 'sending' || reason.trim() === ''}
          className="rounded-lg bg-[#0073E6] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {state === 'sending' ? 'Mengirim...' : 'Kirim permintaan'}
        </button>
        <button type="button" onClick={() => setState('closed')} className="text-xs text-text-secondary hover:underline">
          Batal
        </button>
      </div>
    </div>
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
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${text} shrink-0`}
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
      <p className="text-text text-base font-semibold text-center">
        Anda belum pernah berdonasi
      </p>
      <p className="text-text-secondary text-sm text-center mt-1">
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
          className="w-8 h-8 text-danger"
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
      <p className="text-text text-sm text-center">{message}</p>
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
    <div className="min-h-screen bg-bg-secondary pb-20">
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
        <div key={i} className="bg-white rounded-xl shadow-xs p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 bg-border rounded animate-pulse" />
              <div className="h-3 w-24 bg-border rounded animate-pulse" />
            </div>
            <div className="h-5 w-16 bg-border rounded-full animate-pulse" />
          </div>
          <div className="mt-3 pt-3 border-t border-border">
            <div className="h-4 w-28 bg-border rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
