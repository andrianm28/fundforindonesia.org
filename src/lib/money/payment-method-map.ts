import type { ChargeResult, PaymentMethod } from '@/lib/payments';

/** Every payment method choice the donor-facing UI still offers. */
export const VALID_PAYMENT_METHODS = ['bank_transfer', 'qris', 'ewallet', 'credit_card'] as const;

export type DonationPaymentMethod = (typeof VALID_PAYMENT_METHODS)[number];

/**
 * What each donor-facing choice means to a provider.
 *
 * `credit_card` stays in the enum because the frontend contract depends on it,
 * and maps to nothing: no adapter implements it, and inventing payment
 * instructions for a method nobody can pay through is the habit this money
 * layer exists to end. `ewallet` maps to `ewallet_redirect`, which no adapter
 * in this build declares yet: until one lists it in `supportedMethods` (and an
 * Admin switches it on), the donation routes refuse it like any unavailable
 * method.
 *
 * Shared by POST /api/donations (the first attempt) and POST
 * /api/donations/[id]/retry (every attempt after), so the two routes can
 * never disagree about what a stored `paymentMethod` string actually charges
 * through.
 */
export const PROVIDER_METHOD_FOR: Record<DonationPaymentMethod, PaymentMethod | null> = {
  bank_transfer: 'bank_transfer_va',
  qris: 'qris_redirect',
  ewallet: 'ewallet_redirect',
  credit_card: null,
};

/**
 * What the donor is told to do, built from what the provider actually issued
 * and never from anything invented locally. Shared by the donation route and
 * its retry, so a new method is one branch here rather than two copies.
 */
export function paymentInstructionsFor(charge: ChargeResult) {
  switch (charge.method) {
    case 'qris_redirect':
      return { type: 'qris' as const, redirectUrl: charge.redirectUrl, expiresAt: charge.expiresAt };
    case 'ewallet_redirect':
      return { type: 'ewallet' as const, redirectUrl: charge.redirectUrl, expiresAt: charge.expiresAt };
    case 'bank_transfer_va':
      return { type: 'bank_transfer' as const, vaNumber: charge.vaNumber, expiresAt: charge.expiresAt };
  }
}
