import type { PaymentMethod } from '@/lib/payments';

/** Every payment method choice the donor-facing UI still offers. */
export const VALID_PAYMENT_METHODS = ['bank_transfer', 'qris', 'ewallet', 'credit_card'] as const;

export type DonationPaymentMethod = (typeof VALID_PAYMENT_METHODS)[number];

/**
 * What each donor-facing choice means to a provider.
 *
 * `ewallet` and `credit_card` stay in the enum because the frontend contract
 * depends on them, and map to nothing: no adapter implements either, and
 * inventing payment instructions for a method nobody can pay through is the
 * habit this money layer exists to end.
 *
 * Shared by POST /api/donations (the first attempt) and POST
 * /api/donations/[id]/retry (every attempt after), so the two routes can
 * never disagree about what a stored `paymentMethod` string actually charges
 * through.
 */
export const PROVIDER_METHOD_FOR: Record<DonationPaymentMethod, PaymentMethod | null> = {
  bank_transfer: 'bank_transfer_va',
  qris: 'qris_redirect',
  ewallet: null,
  credit_card: null,
};
