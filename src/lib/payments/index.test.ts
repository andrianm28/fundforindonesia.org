import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getPaymentProvider,
  PaymentProviderNotConfiguredError,
  UnknownPaymentProviderError,
  MockPaymentProvider,
} from './index';
import { SumopodProvider } from './sumopod-provider';

/**
 * The registry decides which adapter answers a given webhook URL, which makes
 * it part of the money path: resolving an unknown name to *any* provider is
 * how a forged notification finds a verifier that will accept it.
 */

const ENV_KEYS = [
  'PAYMENT_PROVIDER',
  'MOCK_MIDTRANS_SERVER_KEY',
  'SUMOPOD_API_KEY',
  'SUMOPOD_WEBHOOK_SECRET',
  'SUMOPOD_BASE_URL',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.MOCK_MIDTRANS_SERVER_KEY = 'SB-Mid-server-TEST';
  process.env.SUMOPOD_API_KEY = 'sumopod-key';
  process.env.SUMOPOD_WEBHOOK_SECRET = 'whsec_OkjY4nDqKbBxbBRPcHjT5ZvpXeWTm6J2';
  process.env.SUMOPOD_BASE_URL = 'https://api-pay-sandbox.sumopod.com/api/v1';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('getPaymentProvider with no name', () => {
  it('resolves the mock when PAYMENT_PROVIDER is unset', () => {
    expect(getPaymentProvider()).toBeInstanceOf(MockPaymentProvider);
  });

  it('resolves Sumopod when PAYMENT_PROVIDER says so', () => {
    process.env.PAYMENT_PROVIDER = 'sumopod';

    expect(getPaymentProvider()).toBeInstanceOf(SumopodProvider);
  });
});

describe('getPaymentProvider by name', () => {
  it('resolves sumopod by name even when the active provider is the mock', () => {
    // This is the webhook route's case: the URL names the provider, and it
    // need not be the one currently taking charges.
    expect(getPaymentProvider('sumopod')).toBeInstanceOf(SumopodProvider);
  });

  it('resolves mock by name', () => {
    expect(getPaymentProvider('mock')).toBeInstanceOf(MockPaymentProvider);
  });

  it('ignores case, because the name arrives from a URL path', () => {
    expect(getPaymentProvider('SumoPod')).toBeInstanceOf(SumopodProvider);
  });

  it('refuses an unknown name instead of falling back to any provider', () => {
    // The bug this closes: the route used to ignore its URL parameter, so
    // /api/webhooks/anything was verified as if it were Midtrans.
    expect(() => getPaymentProvider('stripe')).toThrow(UnknownPaymentProviderError);
  });

  it('refuses an empty name rather than treating it as the default', () => {
    expect(() => getPaymentProvider('')).toThrow(UnknownPaymentProviderError);
  });
});

describe('getPaymentProvider when a named provider is not configured', () => {
  it('reports sumopod unconfigured when the api key is missing', () => {
    delete process.env.SUMOPOD_API_KEY;

    expect(() => getPaymentProvider('sumopod')).toThrow(PaymentProviderNotConfiguredError);
  });

  it('reports sumopod unconfigured when the webhook secret is missing', () => {
    // Without this the adapter would verify every signature against an empty
    // secret, which accepts anything while looking healthy.
    delete process.env.SUMOPOD_WEBHOOK_SECRET;

    expect(() => getPaymentProvider('sumopod')).toThrow(PaymentProviderNotConfiguredError);
  });

  it('reports sumopod unconfigured when the base url is missing', () => {
    delete process.env.SUMOPOD_BASE_URL;

    expect(() => getPaymentProvider('sumopod')).toThrow(PaymentProviderNotConfiguredError);
  });

  it('reports the mock unconfigured when its server key is missing', () => {
    delete process.env.MOCK_MIDTRANS_SERVER_KEY;

    expect(() => getPaymentProvider('mock')).toThrow(PaymentProviderNotConfiguredError);
  });

  it('distinguishes unconfigured from unknown, because they need different answers', () => {
    // The route answers 503 for unconfigured ("we cannot verify") and must
    // not answer the same for unknown ("there is no such provider").
    delete process.env.SUMOPOD_API_KEY;

    expect(() => getPaymentProvider('sumopod')).not.toThrow(UnknownPaymentProviderError);
  });
});
