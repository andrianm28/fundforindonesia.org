import type { PaymentMethod } from '@/lib/payments/types';

/**
 * The method a Registration asks the API to charge with, and how it maps to
 * what a payment provider declares it can charge (`PaymentProvider.method`).
 * One table for the route and for the page that chooses the button's method,
 * so the two cannot disagree. Pure types and data: safe for client code.
 */
export type RegistrationPaymentMethod = 'bank_transfer' | 'qris';

export const PROVIDER_METHOD_FOR: Record<RegistrationPaymentMethod, PaymentMethod> = {
  bank_transfer: 'bank_transfer_va',
  qris: 'qris_redirect',
};

/** The Registration method the active provider can charge. */
export function registrationMethodFor(providerMethod: PaymentMethod): RegistrationPaymentMethod {
  switch (providerMethod) {
    case 'bank_transfer_va':
      return 'bank_transfer';
    case 'qris_redirect':
      return 'qris';
    default: {
      const unknown: never = providerMethod;
      throw new Error(`Metode pembayaran provider tidak dikenal: ${String(unknown)}`);
    }
  }
}
