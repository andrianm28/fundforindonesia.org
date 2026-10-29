'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { safePaymentLink } from '@/lib/money/payment-result';

/** How often, and for how long, a waiting page re-reads the status: 5 s for 2 minutes. */
const REFRESH_INTERVAL_MS = 5_000;
const REFRESH_LIMIT = 24;

export interface PaymentResultActionsProps {
  /** The page's own signed token: the retry is addressed by it, never by the Donation id. */
  token: string;
  /** The latest Payment is still open: re-read the page until the webhook lands. */
  waiting: boolean;
  /** The open charge's own payment link, for a Donor who backed out of it. */
  continueUrl: string | null;
  /** The latest attempt is over and the Campaign still takes donations: a new attempt on the SAME Donation is allowed. */
  canRetry: boolean;
}

/**
 * The result page's moving parts (ticket 98): a quiet re-read while waiting for
 * the webhook, the way back into an open charge, and "pay again" through
 * POST /api/donations/result/[token]/retry, which keeps the Donation and makes
 * a new Payment on it.
 */
export function PaymentResultActions({ token, waiting, continueUrl, canRetry }: PaymentResultActionsProps) {
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
      const res = await fetch(`/api/donations/result/${encodeURIComponent(token)}/retry`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Gagal memproses pembayaran ulang. Silakan coba lagi.');
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
