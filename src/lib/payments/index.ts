import { MockPaymentProvider } from './mock-provider';
import { SumopodProvider } from './sumopod-provider';
import type { PaymentProvider } from './types';

export { computeMidtransSignature, verifyMidtransSignature } from './signature';
export {
  computeSumopodSignature,
  verifySumopodSignature,
  SUMOPOD_REPLAY_TOLERANCE_SECONDS,
} from './sumopod-signature';
export { MockPaymentProvider, InvalidWebhookSignatureError } from './mock-provider';
export { SumopodProvider, SumopodNotSupportedError } from './sumopod-provider';
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
 * Raised when something asks for a provider this build does not have.
 *
 * Kept apart from PaymentProviderNotConfiguredError because the two deserve
 * different answers: an unconfigured provider is an outage worth retrying, an
 * unknown one never becomes valid no matter how often it is retried. The
 * distinction also stops the old behaviour, where the webhook route ignored
 * the provider in its URL and verified every delivery as if it were Midtrans
 * -- so any path under /api/webhooks/ reached a verifier that was never meant
 * to see it.
 */
export class UnknownPaymentProviderError extends Error {
  constructor(name: string) {
    super(`No payment provider named ${JSON.stringify(name)} is registered.`);
    this.name = 'UnknownPaymentProviderError';
  }
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new PaymentProviderNotConfiguredError(key);
  return value;
}

/**
 * Every provider this build can speak to, keyed by the name that appears in
 * its webhook URL. Adding one is a new entry here plus an adapter; nothing
 * else in the app names a provider.
 */
const BUILDERS: Record<string, () => PaymentProvider> = {
  mock: () => new MockPaymentProvider({ serverKey: requireEnv('MOCK_MIDTRANS_SERVER_KEY') }),
  sumopod: () =>
    new SumopodProvider({
      apiKey: requireEnv('SUMOPOD_API_KEY'),
      webhookSecret: requireEnv('SUMOPOD_WEBHOOK_SECRET'),
      baseUrl: requireEnv('SUMOPOD_BASE_URL'),
    }),
};

/**
 * The provider a given call should use.
 *
 * With no argument this is the provider currently taking money, named by
 * PAYMENT_PROVIDER and defaulting to the mock: that is what the donation and
 * payout routes want, since they act as the platform.
 *
 * With a name it is that specific provider, which is what the webhook route
 * wants: a notification arrives addressed to whoever sent it, and that may
 * not be the provider currently taking new charges -- a payment made before
 * a provider switch still settles afterwards.
 */
export function getPaymentProvider(name?: string): PaymentProvider {
  const requested = name === undefined ? (process.env.PAYMENT_PROVIDER ?? 'mock') : name;
  const build = BUILDERS[requested.toLowerCase()];
  if (!build) throw new UnknownPaymentProviderError(requested);
  return build();
}
