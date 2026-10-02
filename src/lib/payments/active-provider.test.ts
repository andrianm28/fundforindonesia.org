import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveActivePaymentProvider,
  setPaymentProviderSetting,
  paymentProviderSettingErrorToHttp,
  providerSupportedMethods,
} from './active-provider';
import { PaymentProviderNotConfiguredError } from './index';
import { setEnv } from '../../../tests/support/mutable-env';

/**
 * The Admin's provider choice (prd-compliance 39). It selects the provider for
 * new charges only, never holds a credential, and cannot switch on anything the
 * deployment could not charge through.
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

function dbWith(row: { provider: string; methods: string[] } | null) {
  return {
    paymentProviderSetting: {
      findFirst: vi.fn().mockResolvedValue(row),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 's1', ...data })),
    },
  } as never;
}

function createMock(db: unknown) {
  return (db as { paymentProviderSetting: { create: ReturnType<typeof vi.fn> } }).paymentProviderSetting.create;
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.MOCK_MIDTRANS_SERVER_KEY = 'SB-Mid-server-TEST';
  process.env.SUMOPOD_API_KEY = 'sumopod-key';
  process.env.SUMOPOD_WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.SUMOPOD_BASE_URL = 'https://api-pay.sumopod.com/api/v1';
});
afterEach(() => {
  for (const k of ENV_KEYS) setEnv(k, saved[k]);
});

describe('resolveActivePaymentProvider', () => {
  it('falls back to PAYMENT_PROVIDER with all of its methods when no Admin has chosen', async () => {
    process.env.PAYMENT_PROVIDER = 'sumopod';
    const active = await resolveActivePaymentProvider(dbWith(null));
    expect(active.provider.name).toBe('sumopod');
    expect(active.enabledMethods).toEqual(['qris_redirect']);
    expect(active.source).toBe('environment');
  });

  it('uses the Admin choice over the environment, within what the adapter supports', async () => {
    process.env.PAYMENT_PROVIDER = 'mock';
    const active = await resolveActivePaymentProvider(
      dbWith({ provider: 'sumopod', methods: ['qris_redirect', 'ewallet_redirect'] }),
    );
    expect(active.provider.name).toBe('sumopod');
    expect(active.enabledMethods).toEqual(['qris_redirect']);
    expect(active.source).toBe('admin');
  });

  it('refuses, as unconfigured, an Admin choice whose credentials are missing', async () => {
    delete process.env.SUMOPOD_API_KEY;
    await expect(
      resolveActivePaymentProvider(dbWith({ provider: 'sumopod', methods: ['qris_redirect'] })),
    ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredError);
  });

  it('refuses the mock in production even when an Admin row names it', async () => {
    setEnv('NODE_ENV', 'production');
    process.env.ALLOW_MOCK_PAYMENT_PROVIDER = 'true';
    await expect(
      resolveActivePaymentProvider(dbWith({ provider: 'mock', methods: ['bank_transfer_va'] })),
    ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredError);
  });
});

describe('setPaymentProviderSetting', () => {
  const actorId = 'admin-1';

  it('records the choice as the acting Admin, with a canonical provider name', async () => {
    const db = dbWith(null);
    await setPaymentProviderSetting(db, { provider: 'Sumopod', methods: ['qris_redirect', 'qris_redirect'], actorId });
    expect(createMock(db)).toHaveBeenCalledWith({
      data: { provider: 'sumopod', methods: ['qris_redirect'], setById: 'admin-1' },
    });
  });

  it.each([
    [{ provider: 'midtrans', methods: ['qris_redirect'] }, 400, /tidak dikenal/],
    [{ provider: 'sumopod', methods: [] }, 400, /sedikitnya satu/],
    [{ provider: 'sumopod', methods: ['crypto'] }, 400, /tidak dikenal/],
    [{ provider: 'sumopod', methods: ['ewallet_redirect'] }, 400, /tidak mendukung/],
    [{ provider: 42, methods: ['qris_redirect'] }, 400, /teks/],
  ])('refuses %j without writing', async (input, status, message) => {
    const db = dbWith(null);
    const err = await setPaymentProviderSetting(db, { ...input, actorId }).catch((e) => e);
    expect(paymentProviderSettingErrorToHttp(err)).toEqual({ error: expect.stringMatching(message), status });
    expect(createMock(db)).not.toHaveBeenCalled();
  });

  it('refuses a provider this deployment has no credentials for (409)', async () => {
    delete process.env.SUMOPOD_WEBHOOK_SECRET;
    const db = dbWith(null);
    const err = await setPaymentProviderSetting(db, { provider: 'sumopod', methods: ['qris_redirect'], actorId }).catch(
      (e) => e,
    );
    expect(paymentProviderSettingErrorToHttp(err)?.status).toBe(409);
    expect(createMock(db)).not.toHaveBeenCalled();
  });

  it('refuses the mock and a sandbox provider in production (409)', async () => {
    setEnv('NODE_ENV', 'production');
    process.env.ALLOW_MOCK_PAYMENT_PROVIDER = 'true';
    const db = dbWith(null);
    const mock = await setPaymentProviderSetting(db, { provider: 'mock', methods: ['bank_transfer_va'], actorId }).catch(
      (e) => e,
    );
    expect(paymentProviderSettingErrorToHttp(mock)?.status).toBe(409);

    process.env.SUMOPOD_BASE_URL = 'https://api-pay-sandbox.sumopod.com/api/v1';
    const sandbox = await setPaymentProviderSetting(db, {
      provider: 'sumopod',
      methods: ['qris_redirect'],
      actorId,
    }).catch((e) => e);
    expect(paymentProviderSettingErrorToHttp(sandbox)?.status).toBe(409);
    expect(createMock(db)).not.toHaveBeenCalled();
  });
});

describe('providerSupportedMethods', () => {
  it('is the declared list when there is one, else just the default method', () => {
    expect(providerSupportedMethods({ method: 'qris_redirect' } as never)).toEqual(['qris_redirect']);
    expect(
      providerSupportedMethods({
        method: 'bank_transfer_va',
        supportedMethods: ['bank_transfer_va', 'ewallet_redirect'],
      } as never),
    ).toEqual(['bank_transfer_va', 'ewallet_redirect']);
  });
});
