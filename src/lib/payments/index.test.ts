import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  canonicalPaymentProviderName,
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
  'NODE_ENV',
  'ALLOW_MOCK_PAYMENT_PROVIDER',
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
  // NODE_ENV is typed read-only on process.env; a plain record view is not.
  const env = process.env as Record<string, string | undefined>;
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
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

describe('canonicalPaymentProviderName', () => {
  it('returns the one name this build knows the provider by, whatever case it was typed in', () => {
    // The name is not decoration: the Provider Balance is split by exact
    // string equality, so "Sumopod" and "sumopod" are two pots to the ledger.
    // Whatever writes a provider name onto money has to go through here.
    expect(canonicalPaymentProviderName('SumoPod')).toBe('sumopod');
    expect(canonicalPaymentProviderName('sumopod')).toBe('sumopod');
    expect(canonicalPaymentProviderName('MOCK')).toBe('mock');
  });

  it('agrees with the name the adapter itself reports, so a stamp and a lookup cannot drift apart', () => {
    expect(canonicalPaymentProviderName('Sumopod')).toBe(getPaymentProvider('sumopod').name);
  });

  it('refuses a name this build has no provider for, rather than handing back the text as given', () => {
    expect(() => canonicalPaymentProviderName('zendesk')).toThrow(UnknownPaymentProviderError);
  });

  it('refuses a name that is only a property of Object.prototype, not a registered provider', () => {
    // BUILDERS is an object literal, so `BUILDERS[name]` finds inherited keys.
    // "constructor" and "__proto__" are therefore truthy lookups that resolve to
    // Object's own members rather than to an adapter -- and for the money layer
    // that is worse than a bad lookup, because the returned string is stamped
    // on ledger entries and becomes a Provider Balance bucket of its own.
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(() => canonicalPaymentProviderName(name)).toThrow(UnknownPaymentProviderError);
    }
  });

  it('needs no adapter built, so naming a provider never depends on it being configured', () => {
    // A recorded sweep is a human's account of a movement that already
    // happened; refusing to file it because the provider is not configured
    // would be refusing to record the past. Only the webhook path, which
    // actually talks to the provider, needs it configured.
    for (const k of ENV_KEYS) delete process.env[k];

    expect(canonicalPaymentProviderName('sumopod')).toBe('sumopod');
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

describe('the mock provider outside tests (ticket 51)', () => {
  // process.env.NODE_ENV is typed read-only; a plain record view lets a test set it.
  const env = process.env as Record<string, string | undefined>;

  it('refuses to build in production, even with its key set, and says why', () => {
    env.NODE_ENV = 'production';

    expect(() => getPaymentProvider('mock')).toThrow(PaymentProviderNotConfiguredError);
    expect(() => getPaymentProvider('mock')).toThrow(/ALLOW_MOCK_PAYMENT_PROVIDER/);
  });

  it('refuses the default provider too in production, since the default is the mock', () => {
    env.NODE_ENV = 'production';

    expect(() => getPaymentProvider()).toThrow(PaymentProviderNotConfiguredError);
  });

  it('builds in production only when explicitly opted in with exactly "true"', () => {
    env.NODE_ENV = 'production';

    for (const value of ['1', 'yes', 'TRUE', ' true']) {
      env.ALLOW_MOCK_PAYMENT_PROVIDER = value;
      expect(() => getPaymentProvider('mock')).toThrow(PaymentProviderNotConfiguredError);
    }
    env.ALLOW_MOCK_PAYMENT_PROVIDER = 'true';
    expect(getPaymentProvider('mock')).toBeInstanceOf(MockPaymentProvider);
  });

  it('does not affect sumopod in production', () => {
    env.NODE_ENV = 'production';

    expect(getPaymentProvider('sumopod')).toBeInstanceOf(SumopodProvider);
  });

  it('still builds in development and test without any opt-in', () => {
    for (const nodeEnv of ['development', 'test']) {
      env.NODE_ENV = nodeEnv;
      expect(getPaymentProvider('mock')).toBeInstanceOf(MockPaymentProvider);
    }
  });
});
