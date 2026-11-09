import { MockPaymentProvider } from './mock-provider';
import { SumopodProvider } from './sumopod-provider';
import type { PaymentProvider } from './types';
import { canonicalPaymentProviderName, type PaymentProviderName } from './provider-names';
import { firstSetEnv, merchantEnvKeys, type MerchantEntity } from './merchant';

export {
  canonicalPaymentProviderName,
  UnknownPaymentProviderError,
  type PaymentProviderName,
} from './provider-names';
export {
  canonicalMerchantEntity,
  merchantEntityForPurpose,
  merchantFromUrlSegment,
  merchantUrlSegment,
  MERCHANT_ENTITIES,
  UnknownMerchantEntityError,
  type MerchantEntity,
  type MerchantPurpose,
} from './merchant';
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
 * The first of `keys` that is set (non-empty). When none is, the error names
 * the PRIMARY (first) key and the merchant, so the message for a commercial
 * charge says SUMOPOD_BADAN_USAHA_API_KEY, never the legacy yayasan name.
 */
function requireMerchantEnv(keys: string[], merchant: MerchantEntity): string {
  const found = firstSetEnv(keys);
  if (found) return found.value;
  throw new PaymentProviderNotConfiguredError(
    `${keys[0]} (credentials of the ${merchant} merchant account; a ${merchant} charge is refused, never moved to another merchant)`,
  );
}

/**
 * The mock adapter's own gate (ticket 51). The mock does verify an HMAC
 * signature with its serverKey (mock-provider.ts:120-130), but anyone holding
 * that key can forge a valid event, and the key is the kind of variable
 * that survives a copied .env into production unnoticed, so "the key is set"
 * must not be what turns it on. Outside production it is always available
 * (dev, vitest, CI e2e). In production it needs a deliberate, separate
 * ALLOW_MOCK_PAYMENT_PROVIDER=true -- exactly that string, as with the other
 * switches in this repo -- and otherwise answers as unconfigured, which the
 * webhook route turns into a 503 and no route into a settlement.
 */
function requireMockAllowed(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.ALLOW_MOCK_PAYMENT_PROVIDER === 'true') return;
  throw new PaymentProviderNotConfiguredError(
    'ALLOW_MOCK_PAYMENT_PROVIDER (the mock payment provider is disabled when NODE_ENV=production)',
  );
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
const BUILDERS: Record<PaymentProviderName, (merchant: MerchantEntity) => PaymentProvider> = {
  mock: () => {
    requireMockAllowed();
    // The mock has no merchant accounts: it never moves money and is refused in
    // production, so both entities share its one key (development only).
    return new MockPaymentProvider({ serverKey: requireEnv('MOCK_MIDTRANS_SERVER_KEY') });
  },
  // One gateway, two merchant accounts (ADR 0027): credentials and the webhook
  // secret are per merchant. YAYASAN falls back to the pre-ADR variable names so
  // production keeps working until the owner sets SUMOPOD_YAYASAN_*;
  // BADAN_USAHA has no fallback at all.
  sumopod: (merchant) => {
    const keys = merchantEnvKeys(merchant);
    return new SumopodProvider({
      merchant,
      apiKey: requireMerchantEnv(keys.apiKey, merchant),
      webhookSecret: requireMerchantEnv(keys.webhookSecret, merchant),
      baseUrl: requireMerchantEnv(keys.baseUrl, merchant),
    });
  },
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
export function getPaymentProvider(name?: string, merchant: MerchantEntity = 'YAYASAN'): PaymentProvider {
  const requested = name === undefined ? (process.env.PAYMENT_PROVIDER ?? 'mock') : name;
  return BUILDERS[canonicalPaymentProviderName(requested)](merchant);
}
