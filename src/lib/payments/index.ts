import { MockPaymentProvider } from './mock-provider';
import { SumopodProvider } from './sumopod-provider';
import type { PaymentProvider } from './types';
import { canonicalPaymentProviderName, type PaymentProviderName } from './provider-names';

export {
  canonicalPaymentProviderName,
  UnknownPaymentProviderError,
  type PaymentProviderName,
} from './provider-names';
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

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new PaymentProviderNotConfiguredError(key);
  return value;
}

/**
 * Every provider this build can speak to, keyed by the name that appears in
 * its webhook URL. Adding one is a new name in provider-names.ts plus a
 * builder here; nothing else in the app names a provider.
 *
 * AND THE ONE RULE ABOUT THE NAME, which is why that file exists separately
 * from this one: every piece of code that names a provider goes through
 * canonicalPaymentProviderName (./provider-names.ts), which is what makes this
 * registry the one list rather than a convention. An Admin who writes "Sumopod"
 * -- the spelling on the dashboard -- and a webhook that stamps "sumopod" are
 * two pots to the ledger, and the sweep's credit lands in a bucket the pot that
 * was checked never had. The name lives apart from the adapters so that code
 * which only needs a name does not load one; the rule does not soften for that.
 *
 * Keyed on the names module's own union, so the registry and the list of
 * registered names cannot drift: a name with no builder below, or a builder
 * for a name that is not registered, is a compile error rather than a name
 * that resolves to no adapter at all.
 */
const BUILDERS: Record<PaymentProviderName, () => PaymentProvider> = {
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
  return BUILDERS[canonicalPaymentProviderName(requested)]();
}
