import { MockPaymentProvider } from './mock-provider';
import type { PaymentProvider } from './types';

export { computeMidtransSignature, verifyMidtransSignature } from './signature';
export { MockPaymentProvider, InvalidWebhookSignatureError } from './mock-provider';
export type {
  ChargeInput,
  ChargeResult,
  PayoutInput,
  PayoutResult,
  PaymentMethod,
  PaymentProvider,
  PaymentStatusResult,
  WebhookEvent,
} from './types';

/**
 * Raised when the provider cannot be built because it is not configured.
 *
 * Distinct from a signature failure on purpose: routes answer 503 for this and
 * 401 for that. "We cannot check" and "this is forged" are different facts, and
 * collapsing them either hides an outage or hides an attack.
 */
export class PaymentProviderNotConfiguredError extends Error {
  constructor(missing: string) {
    super(
      `${missing} is not set. The payment provider refuses to run unconfigured: ` +
        'verifying signatures against an empty secret accepts anything.',
    );
    this.name = 'PaymentProviderNotConfiguredError';
  }
}

/**
 * The provider this deployment uses.
 *
 * One place to change when a real merchant account exists. Everything else --
 * the webhook route, the donation flow, the payout flow -- depends on the
 * PaymentProvider interface and not on which provider answers.
 */
export function getPaymentProvider(): PaymentProvider {
  const serverKey = process.env.MOCK_MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    throw new PaymentProviderNotConfiguredError('MOCK_MIDTRANS_SERVER_KEY');
  }
  return new MockPaymentProvider({ serverKey });
}
