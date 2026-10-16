'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { safePaymentLink } from '@/lib/money/payment-result';

/** How often, and for how long, a waiting page re-reads the status: 5 s for 2 minutes. */
const REFRESH_INTERVAL_MS = 5_000;
const REFRESH_LIMIT = 24;

export interface PaymentResultActionsProps {
  donationId: string;
  /** The latest Payment is still open: re-read the page until the webhook lands. */
  waiting: boolean;
  /** The open charge's own payment link, for a Donor who backed out of it. */
  continueUrl: string | null;
  /** The latest attempt failed or expired: a new attempt on the SAME Donation is allowed. */
  canRetry: boolean;
  /** A signed-in Donor's Donation: the retry route needs their session. */
  accountOwned: boolean;
}

/**
 * The result page's moving parts (ticket 98): a quiet re-read while waiting for
 * the webhook, the way back into an open charge, and "pay again" through
 * POST /api/donations/[id]/retry, which keeps the Donation and makes a new
 * Payment on it.
 */
export function PaymentResultActions({ donationId, waiting, continueUrl, canRetry, accountOwned }: PaymentResultActionsProps) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!waiting) return;
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      if (count > REFRESH_LIMIT) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [waiting, router]);

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      const res = await fetch(`/api/donations/${donationId}/retry`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The retry route hides another account's Donation behind a 404, which
        // is also what a signed-out owner gets.
        setError(
          res.status === 404 && accountOwned
            ? 'Masuk ke akun yang Anda pakai untuk berdonasi, lalu coba lagi.'
            : data.error || 'Gagal memproses pembayaran ulang. Silakan coba lagi.',
        );
        return;
      }
      const redirectUrl = safePaymentLink(data?.paymentInstructions?.redirectUrl ?? null);
      if (redirectUrl) {
        window.location.assign(redirectUrl);
        return;
      }
      // A bank transfer has no link: the refreshed page shows its new VA number.
      router.refresh();
    } catch {
      setError('Gagal memproses pembayaran ulang. Silakan coba lagi.');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      {continueUrl && (
        <a
          href={continueUrl}
          rel="noreferrer"
          className="block rounded-xl bg-[#0073E6] px-4 py-3 text-center text-sm font-semibold text-white"
        >
          Lanjutkan pembayaran
        </a>
      )}
      {canRetry && (
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="block w-full rounded-xl bg-[#0073E6] px-4 py-3 text-center text-sm font-semibold text-white disabled:opacity-60"
        >
          {retrying ? 'Memproses...' : 'Coba bayar lagi'}
        </button>
      )}
      {error && (
        <p role="alert" className="text-center text-sm text-[#C62828]">
          {error}
        </p>
      )}
    </>
  );
}
