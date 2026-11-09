// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPaymentProvider, PaymentProviderNotConfiguredError, SumopodProvider } from './index';
import { setEnv } from '../../../tests/support/mutable-env';

/**
 * pks-pemenuhan/04, scope 1 and 3: two merchants at one gateway. The old
 * SUMOPOD_* variables keep meaning YAYASAN; BADAN_USAHA has its own and no
 * fallback, so a commercial charge can never land on the yayasan's account.
 */

const ENV_KEYS = [
  'PAYMENT_PROVIDER',
  'SUMOPOD_API_KEY',
  'SUMOPOD_WEBHOOK_SECRET',
  'SUMOPOD_BASE_URL',
  'SUMOPOD_YAYASAN_API_KEY',
  'SUMOPOD_YAYASAN_WEBHOOK_SECRET',
  'SUMOPOD_YAYASAN_BASE_URL',
  'SUMOPOD_BADAN_USAHA_API_KEY',
  'SUMOPOD_BADAN_USAHA_WEBHOOK_SECRET',
  'SUMOPOD_BADAN_USAHA_BASE_URL',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) setEnv(k, saved[k]);
});

function setLegacy() {
  process.env.SUMOPOD_API_KEY = 'legacy-key';
  process.env.SUMOPOD_WEBHOOK_SECRET = 'whsec_legacy';
  process.env.SUMOPOD_BASE_URL = 'https://api-pay-sandbox.sumopod.com/api/v1';
}

function setBadanUsaha() {
  process.env.SUMOPOD_BADAN_USAHA_API_KEY = 'bu-key';
  process.env.SUMOPOD_BADAN_USAHA_WEBHOOK_SECRET = 'whsec_bu';
  process.env.SUMOPOD_BADAN_USAHA_BASE_URL = 'https://api-pay-sandbox.sumopod.com/api/v1';
}

describe('getPaymentProvider with a merchant', () => {
  it('defaults to YAYASAN and builds from the legacy env, so production is unchanged', () => {
    setLegacy();
    const provider = getPaymentProvider('sumopod');
    expect(provider).toBeInstanceOf(SumopodProvider);
    expect(provider.merchant).toBe('YAYASAN');
    expect(getPaymentProvider('sumopod', 'YAYASAN').merchant).toBe('YAYASAN');
  });

  it('prefers the SUMOPOD_YAYASAN_* names over the legacy ones, variable by variable', async () => {
    setLegacy();
    process.env.SUMOPOD_YAYASAN_API_KEY = 'yayasan-key';
    const provider = getPaymentProvider('sumopod', 'YAYASAN') as SumopodProvider;
    // @ts-expect-error private, read only to assert which credential was picked
    expect(provider.apiKey).toBe('yayasan-key');
    // @ts-expect-error private, the secret was not overridden so the legacy one stays
    expect(provider.webhookSecret).toBe('whsec_legacy');
  });

  it('refuses BADAN_USAHA when only the legacy env is set, never falling back to the yayasan', () => {
    setLegacy();
    expect(() => getPaymentProvider('sumopod', 'BADAN_USAHA')).toThrow(PaymentProviderNotConfiguredError);
    expect(() => getPaymentProvider('sumopod', 'BADAN_USAHA')).toThrow(/SUMOPOD_BADAN_USAHA_API_KEY/);
    expect(() => getPaymentProvider('sumopod', 'BADAN_USAHA')).toThrow(/BADAN_USAHA/);
  });

  it('builds BADAN_USAHA from its own variables, with its own webhook secret', () => {
    setLegacy();
    setBadanUsaha();
    const provider = getPaymentProvider('sumopod', 'BADAN_USAHA') as SumopodProvider;
    expect(provider.merchant).toBe('BADAN_USAHA');
    // @ts-expect-error private, read only to assert which credential was picked
    expect(provider.apiKey).toBe('bu-key');
    // @ts-expect-error private
    expect(provider.webhookSecret).toBe('whsec_bu');
  });

  it('refuses BADAN_USAHA when a variable of the set is missing', () => {
    setBadanUsaha();
    delete process.env.SUMOPOD_BADAN_USAHA_WEBHOOK_SECRET;
    expect(() => getPaymentProvider('sumopod', 'BADAN_USAHA')).toThrow(/SUMOPOD_BADAN_USAHA_WEBHOOK_SECRET/);
  });

  it('treats an empty BADAN_USAHA variable as unset', () => {
    setBadanUsaha();
    process.env.SUMOPOD_BADAN_USAHA_API_KEY = '';
    expect(() => getPaymentProvider('sumopod', 'BADAN_USAHA')).toThrow(PaymentProviderNotConfiguredError);
  });
});
