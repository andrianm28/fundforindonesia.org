import type { PrismaClient } from '@/generated/prisma/client';
import { getPaymentProvider, PaymentProviderNotConfiguredError } from './index';
import { paymentProviderProductionRefusal } from './production-readiness';
import {
  canonicalPaymentProviderName,
  UnknownPaymentProviderError,
  type PaymentProviderName,
} from './provider-names';
import type { PaymentMethod, PaymentProvider } from './types';

/**
 * Which Payment Provider takes NEW charges, and through which methods
 * (prd-compliance 39): the Admin's choice from the dashboard when there is one,
 * the deployment's PAYMENT_PROVIDER when there is not.
 *
 * Only new charges. A webhook never reads this: it is verified by the provider
 * named in its own URL (getPaymentProvider(name), webhooks/[provider]), so a
 * Payment created before a switch still settles after it, and late settlement
 * is untouched. Credentials are never stored or chosen here -- they are
 * environment variables read by the registry's builders (ADR 0011), and a
 * provider whose variables are missing cannot be switched on at all.
 */

type SettingDb = Pick<PrismaClient, 'paymentProviderSetting'>;

/** Every PaymentMethod value, the vocabulary an Admin may switch on. */
export const ALL_PAYMENT_METHODS: readonly PaymentMethod[] = [
  'bank_transfer_va',
  'qris_redirect',
  'ewallet_redirect',
];

/** What a provider can charge through: its declared list, else just its `method`. */
export function providerSupportedMethods(provider: PaymentProvider): readonly PaymentMethod[] {
  return provider.supportedMethods ?? [provider.method];
}

export interface ActivePaymentProvider {
  provider: PaymentProvider;
  /** The methods a donor may be offered right now: the Admin's pick, within what the adapter supports. */
  enabledMethods: readonly PaymentMethod[];
  /** Whether an Admin chose this or the environment default is in force. */
  source: 'admin' | 'environment';
}

/**
 * The provider and methods in force. Throws PaymentProviderNotConfiguredError --
 * which every money route already answers with a 503 -- when the chosen provider
 * is not configured here, or may not take money in this environment (the mock,
 * or a sandbox, in production). The check repeats at charge time on purpose: an
 * Admin's row says what was valid when it was written, not what is valid now.
 */
export async function resolveActivePaymentProvider(db: SettingDb): Promise<ActivePaymentProvider> {
  const row = await db.paymentProviderSetting.findFirst({ orderBy: { setAt: 'desc' } });

  const name = row ? row.provider : (process.env.PAYMENT_PROVIDER ?? 'mock');
  const provider = getPaymentProvider(name);

  if (row && process.env.NODE_ENV === 'production') {
    const refusal = paymentProviderProductionRefusal(name);
    if (refusal) throw new PaymentProviderNotConfiguredError(refusal);
  }

  const supported = providerSupportedMethods(provider);
  if (!row) return { provider, enabledMethods: supported, source: 'environment' };

  // A stored method the adapter no longer supports is dropped rather than
  // trusted: the Admin's row cannot widen what the code can actually charge.
  const enabledMethods = supported.filter((m) => row.methods.includes(m));
  return { provider, enabledMethods, source: 'admin' };
}

export class InvalidPaymentProviderSettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPaymentProviderSettingError';
  }
}

/** The choice is refused because this deployment cannot honour it. */
export class PaymentProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentProviderUnavailableError';
  }
}

/**
 * An Admin switches a provider and its methods on (POST
 * /api/admin/payment-providers). An insert, never an update, so who chose what
 * and when stays readable. Refused, writing nothing, when the name is not a
 * registered provider, when it is not configured in this deployment (its
 * credentials are environment variables nobody can supply from a form), when it
 * may not take money in production, or when a method is one it does not support.
 */
export async function setPaymentProviderSetting(
  db: SettingDb,
  params: { provider: unknown; methods: unknown; actorId: string },
) {
  if (typeof params.provider !== 'string') {
    throw new InvalidPaymentProviderSettingError('Penyedia pembayaran harus berupa teks.');
  }
  let name: PaymentProviderName;
  try {
    name = canonicalPaymentProviderName(params.provider);
  } catch (error) {
    if (error instanceof UnknownPaymentProviderError) {
      throw new InvalidPaymentProviderSettingError(
        `Penyedia pembayaran ${JSON.stringify(params.provider)} tidak dikenal.`,
      );
    }
    throw error;
  }

  if (!Array.isArray(params.methods) || params.methods.length === 0) {
    throw new InvalidPaymentProviderSettingError('Pilih sedikitnya satu metode pembayaran.');
  }
  const requested = params.methods as unknown[];
  for (const m of requested) {
    if (typeof m !== 'string' || !(ALL_PAYMENT_METHODS as readonly string[]).includes(m)) {
      throw new InvalidPaymentProviderSettingError(`Metode pembayaran ${JSON.stringify(m)} tidak dikenal.`);
    }
  }

  let provider: PaymentProvider;
  try {
    provider = getPaymentProvider(name);
  } catch (error) {
    if (error instanceof PaymentProviderNotConfiguredError) {
      throw new PaymentProviderUnavailableError(
        `${name} belum dikonfigurasi di server ini, jadi belum bisa diaktifkan. Kredensialnya hanya lewat environment variable.`,
      );
    }
    throw error;
  }

  if (process.env.NODE_ENV === 'production') {
    const refusal = paymentProviderProductionRefusal(name);
    if (refusal) throw new PaymentProviderUnavailableError(refusal);
  }

  const supported = providerSupportedMethods(provider);
  const methods = [...new Set(requested as PaymentMethod[])];
  const unsupported = methods.filter((m) => !supported.includes(m));
  if (unsupported.length > 0) {
    throw new InvalidPaymentProviderSettingError(`${name} tidak mendukung metode ${unsupported.join(', ')}.`);
  }

  return db.paymentProviderSetting.create({
    data: { provider: name, methods, setById: params.actorId },
  });
}

export function paymentProviderSettingErrorToHttp(error: unknown): { error: string; status: number } | null {
  if (error instanceof InvalidPaymentProviderSettingError) return { error: error.message, status: 400 };
  if (error instanceof PaymentProviderUnavailableError) return { error: error.message, status: 409 };
  return null;
}
