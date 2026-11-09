// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { computeSumopodSignature } from '@/lib/payments/sumopod-signature';
import { setEnv } from '../../../../../tests/support/mutable-env';

/**
 * pks-pemenuhan/04 (independent review follow-up): the merchant routes driven
 * through the REAL payment registry and the REAL environment, not a stubbed
 * adapter. route.test.ts stubs `getPaymentProvider`, so it can say which
 * merchant the route asks for but not what the registry then does with the
 * environment. Two things only the real wiring can show:
 *
 * 1. The same webhook secret configured for both merchants (a misconfiguration,
 *    which env-check warns about) must not let a Payment of merchant A be
 *    settled through merchant B's URL: the delivery verifies, and the Payment's
 *    own merchant check still refuses it.
 * 2. With SUMOPOD_BADAN_USAHA_WEBHOOK_SECRET unset, /badan-usaha answers 503
 *    and never falls back to the yayasan's secret, even when that one is set.
 *
 * Only the database is mocked.
 */

const mockWebhookEventCreate = vi.fn();
const mockWebhookEventUpdate = vi.fn();
const mockPaymentFindUnique = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/prisma', () => {
  const prisma = {
    webhookEvent: {
      create: (...a: unknown[]) => mockWebhookEventCreate(...a),
      update: (...a: unknown[]) => mockWebhookEventUpdate(...a),
      findUniqueOrThrow: vi.fn(),
    },
    payment: { findUnique: (...a: unknown[]) => mockPaymentFindUnique(...a) },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  };
  return { prisma, default: prisma };
});

import { POST as POST_MERCHANT } from './[merchant]/route';

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

const SANDBOX_URL = 'https://api-pay-sandbox.sumopod.com/api/v1';
const SHARED_SECRET = 'whsec_OkjY4nDqKbBxbBRPcHjT5ZvpXeWTm6J2';

const PAYLOAD = {
  event_type: 'payment.completed',
  data: {
    payment_id: '6f1c2f7e-0000-4000-8000-000000000001',
    order_id: 'donation-1',
    amount: 50_000,
    fee: 650,
    net_amount: 49_350,
    status: 'completed',
    payment_method: 'qris',
    paid_at: '2026-09-19T12:00:00Z',
    settled_at: '2026-09-21T12:00:00Z',
    completed_at: '2026-09-21T12:00:00Z',
  },
};

async function signedRequestTo(merchantSegment: string, secret: string): Promise<NextRequest> {
  const body = JSON.stringify(PAYLOAD);
  const id = 'msg_merchant_env_1';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await computeSumopodSignature({ id, timestamp, body }, secret);
  return new NextRequest(`http://localhost:3000/api/webhooks/sumopod/${merchantSegment}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    },
    body,
  });
}

const context = (merchant: string) => ({ params: Promise.resolve({ provider: 'sumopod', merchant }) });

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  vi.clearAllMocks();
  mockWebhookEventCreate.mockResolvedValue({ id: 'we-1' });
  mockWebhookEventUpdate.mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) setEnv(k, saved[k]);
  vi.restoreAllMocks();
});

describe('merchant webhook routes against the real registry and environment', () => {
  it('with the SAME secret on both merchants, a YAYASAN Payment posted to the BADAN_USAHA URL is still refused by the Payment merchant check', async () => {
    process.env.SUMOPOD_YAYASAN_API_KEY = 'y-key';
    process.env.SUMOPOD_YAYASAN_WEBHOOK_SECRET = SHARED_SECRET;
    process.env.SUMOPOD_YAYASAN_BASE_URL = SANDBOX_URL;
    process.env.SUMOPOD_BADAN_USAHA_API_KEY = 'b-key';
    process.env.SUMOPOD_BADAN_USAHA_WEBHOOK_SECRET = SHARED_SECRET;
    process.env.SUMOPOD_BADAN_USAHA_BASE_URL = SANDBOX_URL;
    mockPaymentFindUnique.mockResolvedValue({
      id: 'payment-1',
      provider: 'sumopod',
      merchantEntity: 'YAYASAN',
      status: 'PENDING',
      amount: 50_000,
      donationId: 'donation-1',
      registrationId: null,
    });

    // The signature is valid for this merchant (same secret), so the delivery
    // is accepted as authentic; only the Payment's own merchant stops it.
    const response = await POST_MERCHANT(await signedRequestTo('badan-usaha', SHARED_SECRET), context('badan-usaha'));

    expect(response.status).toBe(200);
    expect(mockPaymentFindUnique).toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    // Not marked processed, so a genuine delivery with this id can still settle.
    expect(mockWebhookEventUpdate).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('REJECTED'));
  });

  it('answers 503 on /badan-usaha when its webhook secret is unset, even with the yayasan secret set (no fallback)', async () => {
    process.env.SUMOPOD_API_KEY = 'legacy-key';
    process.env.SUMOPOD_WEBHOOK_SECRET = SHARED_SECRET;
    process.env.SUMOPOD_BASE_URL = SANDBOX_URL;
    process.env.SUMOPOD_BADAN_USAHA_API_KEY = 'b-key';
    process.env.SUMOPOD_BADAN_USAHA_BASE_URL = SANDBOX_URL;
    // SUMOPOD_BADAN_USAHA_WEBHOOK_SECRET deliberately unset.

    const response = await POST_MERCHANT(await signedRequestTo('badan-usaha', SHARED_SECRET), context('badan-usaha'));

    expect(response.status).toBe(503);
    expect(mockWebhookEventCreate).not.toHaveBeenCalled();
    expect(mockPaymentFindUnique).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
