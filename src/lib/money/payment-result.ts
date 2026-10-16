import type { PaymentStatus } from '@/generated/prisma/client';

/**
 * What a Donation's payment result page (ticket 98) tells the Donor, read from
 * the Payment rows alone. The provider's success redirect is not evidence of
 * payment: only the signed webhook moves a Payment to PAID, so the page says
 * what the database says and nothing more.
 */

export type PaymentResultState = 'menunggu' | 'berhasil' | 'gagal' | 'kedaluwarsa' | 'dikembalikan';

export interface ResultPayment {
  status: PaymentStatus;
  expiresAt: Date | null;
  redirectUrl: string | null;
  createdAt: Date;
}

export interface PaymentResult {
  state: PaymentResultState;
  /** Whether POST /api/donations/[id]/retry would accept this Donation now. */
  canRetry: boolean;
  /** The open charge's own payment link, for a Donor who backed out of it. */
  continueUrl: string | null;
}

export function describePaymentResult(
  donation: { paymentStatus: string; payments: ResultPayment[] },
  now: Date,
): PaymentResult {
  const done = (state: PaymentResultState, canRetry = false): PaymentResult => ({ state, canRetry, continueUrl: null });

  // At most one Payment per Donation can ever be PAID (Payment_donationId_paid_key),
  // and once it is, later attempts do not change that the Donation was paid.
  if (donation.payments.some((p) => p.status === 'PAID')) return done('berhasil');
  if (donation.payments.some((p) => p.status === 'REFUNDED')) return done('dikembalikan');

  const latest = [...donation.payments].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  // No Payment at all: the charge failed before one was written, and the retry
  // route has nothing to retry (it answers 409), so none is offered.
  if (!latest) return done(donation.paymentStatus === 'confirmed' ? 'berhasil' : 'gagal');

  if (latest.status === 'FAILED') return done('gagal', true);
  // A PENDING Payment past its window is expired in effect, judged the same
  // lazy way the retry route judges it.
  if (latest.status === 'EXPIRED' || (latest.expiresAt !== null && latest.expiresAt <= now)) {
    return done('kedaluwarsa', true);
  }

  return { state: 'menunggu', canRetry: false, continueUrl: safePaymentLink(latest.redirectUrl) };
}

/** Only an https link is ever handed to the browser; anything else is dropped. */
function safePaymentLink(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
