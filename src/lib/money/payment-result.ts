import type { PaymentStatus } from '@/generated/prisma/client';

/**
 * What a Donation's payment result page (ticket 98) tells the Donor, read from
 * the Payment rows alone. The provider's success redirect is not evidence of
 * payment: only the signed webhook moves a Payment to PAID, so the page says
 * what the database says and nothing more.
 */

/** How long after a charge's expiry a late `paid` is still waited for before a new charge is offered. */
export const EXPIRY_GRACE_MS = 15 * 60 * 1000;

/**
 * Whether a Donation's latest attempt may be followed by a new charge now:
 * FAILED at once; EXPIRED, or PENDING past its own expiry (judged lazily), only
 * once {@link EXPIRY_GRACE_MS} after `expiresAt` has passed. A provider can still
 * deliver `paid` for a charge shortly after its expiry (ADR 0021 settles it), and
 * offering a second charge in that window is how a Donor ends up paying twice.
 *
 * Shared by the retry route and the result page, so the page never offers what
 * the route refuses. Pure, so the page's client component can import this file.
 */
export function attemptRetryable(latest: { status: PaymentStatus; expiresAt: Date | null }, now: Date): boolean {
  if (latest.status === 'FAILED') return true;
  if (latest.status !== 'EXPIRED' && latest.status !== 'PENDING') return false;
  if (latest.expiresAt === null) return latest.status === 'EXPIRED';
  return latest.expiresAt.getTime() + EXPIRY_GRACE_MS <= now.getTime();
}

export type PaymentResultState = 'menunggu' | 'berhasil' | 'gagal' | 'kedaluwarsa' | 'dikembalikan';

export interface ResultPayment {
  status: PaymentStatus;
  expiresAt: Date | null;
  redirectUrl: string | null;
  vaNumber: string | null;
  createdAt: Date;
}

export interface PaymentResult {
  state: PaymentResultState;
  /** Whether the latest attempt is over, so a retry may open a new charge (the Campaign is checked separately). */
  canRetry: boolean;
  /** The open charge's own payment link, for a Donor who backed out of it. */
  continueUrl: string | null;
  /** The open charge's Virtual Account number, when it is a bank transfer. */
  vaNumber: string | null;
}

export function describePaymentResult(
  donation: { paymentStatus: string; payments: ResultPayment[] },
  now: Date,
): PaymentResult {
  const done = (state: PaymentResultState, canRetry = false): PaymentResult => ({ state, canRetry, continueUrl: null, vaNumber: null });

  // At most one Payment per Donation can ever be PAID (Payment_donationId_paid_key),
  // and once it is, later attempts do not change that the Donation was paid.
  if (donation.payments.some((p) => p.status === 'PAID')) return done('berhasil');
  if (donation.payments.some((p) => p.status === 'REFUNDED')) return done('dikembalikan');

  const latest = [...donation.payments].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  // No Payment at all: the charge failed before one was written, and the retry
  // route has nothing to retry (it answers 409), so none is offered.
  if (!latest) return done(donation.paymentStatus === 'confirmed' ? 'berhasil' : 'gagal');

  if (attemptRetryable(latest, now)) return done(latest.status === 'FAILED' ? 'gagal' : 'kedaluwarsa', true);
  // Expired (or past its window) but still inside the grace period: a late
  // `paid` may yet settle it, so the Donor is told to wait, with no way back
  // into a charge that is closed and no second charge offered.
  if (latest.status === 'EXPIRED' || (latest.expiresAt !== null && latest.expiresAt <= now)) {
    return done('menunggu');
  }

  return {
    state: 'menunggu',
    canRetry: false,
    continueUrl: safePaymentLink(latest.redirectUrl),
    vaNumber: latest.vaNumber,
  };
}

/** Only an https link is ever handed to the browser; anything else is dropped. */
export function safePaymentLink(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export interface TransactionPayment {
  status: PaymentStatus;
  method: string;
  providerRef: string;
  paidAt: Date | null;
  createdAt: Date;
}

export interface TransactionDetails {
  /** Our order id at the provider: the number a Donor or an Admin finds in the provider's dashboard. */
  reference: string;
  /** The method as a Donor knows it, or null for a method this page has no name for. */
  methodLabel: string | null;
  /** When the money arrived, for a paid (or later refunded) Payment; otherwise when the charge was made. */
  at: Date;
  paid: boolean;
}

const METHOD_LABELS: Record<string, string> = {
  qris_redirect: 'QRIS',
  bank_transfer_va: 'Virtual Account (transfer bank)',
  ewallet_redirect: 'E-wallet',
};

/**
 * The attempt the result page reports on (ticket 98, transaction details): the
 * one that was paid when there is one -- the same Payment that settled the
 * Donation, so its reference matches the provider's record of the money --
 * and otherwise the newest attempt. Null when no charge was ever made.
 */
export function transactionDetails(payments: TransactionPayment[]): TransactionDetails | null {
  const settled = payments.find((p) => p.status === 'PAID' || p.status === 'REFUNDED');
  const shown = settled ?? [...payments].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!shown) return null;
  const paid = settled !== undefined && shown.paidAt !== null;
  return {
    reference: shown.providerRef,
    methodLabel: METHOD_LABELS[shown.method] ?? null,
    at: paid ? shown.paidAt! : shown.createdAt,
    paid,
  };
}
