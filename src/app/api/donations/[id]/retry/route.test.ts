import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

const mockSandboxReason = vi.fn<() => string | null>(() => null);
vi.mock('@/lib/donations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/donations')>('@/lib/donations');
  return {
    ...actual,
    donationsEnabled: () => true,
    sandboxInProductionReason: () => mockSandboxReason(),
  };
});

vi.mock('@/lib/prisma', () => {
  const prisma: Record<string, unknown> = {
    donation: { findUnique: vi.fn() },
    paymentProviderSetting: { findFirst: vi.fn().mockResolvedValue(null) },
    payment: { updateMany: vi.fn(), create: vi.fn() },
    chargeWriteFailure: { create: vi.fn() },
    platformFeeRule: { findFirst: vi.fn().mockResolvedValue(null) },
    platformFeeThreshold: { findFirst: vi.fn().mockResolvedValue(null) },
    escrowHoldSetting: { findFirst: vi.fn().mockResolvedValue(null) },
    // The per-Donation advisory lock (donation-retry.ts): granted unless a test says otherwise.
    $queryRaw: vi.fn(),
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});

vi.mock('@/lib/rate-limit-guard', () => ({ checkRateLimit: vi.fn() }));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));

vi.mock('@/lib/payments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments')>('@/lib/payments');
  return { ...actual, getPaymentProvider: vi.fn() };
});

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider } from '@/lib/payments';
import { checkRateLimit } from '@/lib/rate-limit-guard';
import { MAX_RETRIES_IN_FLIGHT } from '@/lib/donation-retry';

const mockDonationFindUnique = prisma.donation.findUnique as unknown as Mock;
const mockPaymentUpdateMany = prisma.payment.updateMany as unknown as Mock;
const mockPaymentCreate = prisma.payment.create as unknown as Mock;
const mockChargeWriteFailureCreate = prisma.chargeWriteFailure.create as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockGetPaymentProvider = getPaymentProvider as unknown as Mock;
const mockQueryRaw = (prisma as unknown as { $queryRaw: Mock }).$queryRaw;
const mockCheckRateLimit = checkRateLimit as unknown as Mock;

function retryRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/donations/donation-1/retry', { method: 'POST' });
}

function routeContext() {
  return { params: Promise.resolve({ id: 'donation-1' }) };
}

const ACTIVE_CAMPAIGN = {
  id: 'campaign-1',
  lifecycleStatus: 'ACTIVE',
  title: 'Bantu Korban Banjir',
  isDemo: false,
  kind: 'DONATION',
  category: 'kesehatan',
  collectingEntity: {
    permits: [{ kinds: ['DONATION'], validFrom: new Date('2020-01-01T00:00:00Z'), validTo: new Date('2099-12-31T00:00:00Z') }],
  },
};

function makeDonation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'donation-1',
    amount: 50_000,
    paymentMethod: 'qris',
    donorId: 'owner-1',
    campaign: ACTIVE_CAMPAIGN,
    payments: [{ id: 'payment-1', status: 'FAILED', expiresAt: new Date('2020-01-02T00:00:00Z') }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSandboxReason.mockReturnValue(null);
  mockQueryRaw.mockResolvedValue([{ locked: true }]);
  mockCheckRateLimit.mockResolvedValue({ ok: true });
  mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1' } });
  mockDonationFindUnique.mockResolvedValue(makeDonation());
  mockPaymentUpdateMany.mockResolvedValue({ count: 1 });
  mockChargeWriteFailureCreate.mockResolvedValue({});
  mockPaymentCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'payment-2',
    ...data,
  }));
  mockGetPaymentProvider.mockReturnValue({
    name: 'sumopod',
    method: 'qris_redirect',
    createCharge: vi.fn().mockResolvedValue({
      providerOrderId: 'donation-1-r2',
      method: 'qris_redirect',
      redirectUrl: 'https://pay.sumopod.com/pay/def',
      expiresAt: new Date('2099-01-02T00:00:00.000Z'),
    }),
  });
});

describe('POST /api/donations/[id]/retry', () => {
  it('returns 503 when sandbox credentials are live in production, before looking up the donation', async () => {
    mockSandboxReason.mockReturnValue('SUMOPOD_BASE_URL points at the Sumopod sandbox in production.');

    const response = await POST(retryRequest(), routeContext());

    expect(response.status).toBe(503);
    expect(mockDonationFindUnique).not.toHaveBeenCalled();
  });

  it('creates a new Payment after the last attempt FAILED, with a fresh order id', async () => {
    const response = await POST(retryRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.paymentInstructions.redirectUrl).toBe('https://pay.sumopod.com/pay/def');
    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        donationId: 'donation-1',
        providerRef: expect.stringMatching(/^donation-1-r[0-9a-f]{8}$/),
        amount: 50_000,
      }),
    });
  });

  it('records a ChargeWriteFailure and answers 503 when the retry charge succeeded but the Payment write failed (ticket 52)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockPaymentCreate.mockRejectedValue(new Error('connection reset by donor@example.com'));

      const response = await POST(retryRequest(), routeContext());

      expect(response.status).toBe(503);
      expect(mockChargeWriteFailureCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          provider: 'sumopod',
          providerRef: expect.stringMatching(/^donation-1-r[0-9a-f]{8}$/),
          subjectType: 'donation',
          subjectId: 'donation-1',
          amount: 50_000,
        }),
      });
      expect(JSON.stringify(mockChargeWriteFailureCreate.mock.calls)).not.toContain('donor@example.com');
    } finally {
      spy.mockRestore();
    }
  });

  it('retries after EXPIRED the same way', async () => {
    mockDonationFindUnique.mockResolvedValue(
      makeDonation({ payments: [{ id: 'payment-1', status: 'EXPIRED', expiresAt: new Date('2020-01-02T00:00:00Z') }] }),
    );

    const response = await POST(retryRequest(), routeContext());

    expect(response.status).toBe(201);
  });

  it('treats a PENDING Payment past its own expiresAt as retryable, and lazily flips it to EXPIRED', async () => {
    mockDonationFindUnique.mockResolvedValue(
      makeDonation({ payments: [{ id: 'payment-1', status: 'PENDING', expiresAt: new Date('2020-01-01T00:00:00Z') }] }),
    );

    const response = await POST(retryRequest(), routeContext());

    expect(response.status).toBe(201);
    expect(mockPaymentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
  });

  it('refuses while another retry of the same Donation holds the lock, without charging (PR #273 review S1)', async () => {
    mockQueryRaw.mockResolvedValue([{ locked: false }]);

    const response = await POST(retryRequest(), routeContext());

    expect(response.status).toBe(409);
    expect(mockDonationFindUnique).not.toHaveBeenCalled();
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('refuses at once beyond the in-flight cap, so retries cannot use up the connection pool (PR #273 re-review R1)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const charge = {
      providerOrderId: 'donation-1-r2',
      method: 'qris_redirect',
      redirectUrl: 'https://pay.sumopod.com/pay/def',
      expiresAt: new Date('2099-01-02T00:00:00.000Z'),
    };
    const createCharge = vi.fn(async () => {
      await gate;
      return charge;
    });
    mockGetPaymentProvider.mockReturnValue({ name: 'sumopod', method: 'qris_redirect', createCharge });

    const running = Array.from({ length: MAX_RETRIES_IN_FLIGHT }, () => POST(retryRequest(), routeContext()));
    await vi.waitFor(() => expect(createCharge).toHaveBeenCalledTimes(MAX_RETRIES_IN_FLIGHT));
    const transactionsBefore = mockQueryRaw.mock.calls.length;

    const refused = await POST(retryRequest(), routeContext());
    expect(refused.status).toBe(503);
    expect((await refused.json()).error).toBe('Sedang banyak permintaan pembayaran ulang. Coba lagi sebentar.');
    expect(mockQueryRaw.mock.calls.length).toBe(transactionsBefore);

    release();
    expect((await Promise.all(running)).map((r) => r.status)).toEqual(Array(MAX_RETRIES_IN_FLIGHT).fill(201));
    // The slots come back once those finish.
    expect((await POST(retryRequest(), routeContext())).status).toBe(201);
  });

  it('waits out the grace period after expiry before charging again, since a late paid can still arrive (S4)', async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    for (const status of ['PENDING', 'EXPIRED']) {
      mockDonationFindUnique.mockResolvedValue(
        makeDonation({ payments: [{ id: 'payment-1', status, expiresAt: fiveMinutesAgo }] }),
      );
      const response = await POST(retryRequest(), routeContext());
      expect(response.status).toBe(409);
    }
    expect(mockPaymentUpdateMany).not.toHaveBeenCalled();
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('refuses with 429 once the address is over its retry limit, before reading the Donation', async () => {
    mockCheckRateLimit.mockResolvedValue({ ok: false, reason: 'limited', retryAfterSeconds: 60 });

    const response = await POST(retryRequest(), routeContext());

    expect(response.status).toBe(429);
    expect(mockDonationFindUnique).not.toHaveBeenCalled();
  });

  it('refuses a Payment still PENDING and not yet expired, with 409 and no new Payment', async () => {
    mockDonationFindUnique.mockResolvedValue(
      makeDonation({ payments: [{ id: 'payment-1', status: 'PENDING', expiresAt: new Date('2099-01-01T00:00:00Z') }] }),
    );

    const response = await POST(retryRequest(), routeContext());

    expect(response.status).toBe(409);
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('refuses a Donation whose last Payment already PAID, with 409 and no new Payment', async () => {
    mockDonationFindUnique.mockResolvedValue(
      makeDonation({ payments: [{ id: 'payment-1', status: 'PAID', expiresAt: null }] }),
    );

    const response = await POST(retryRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe('Donasi ini sudah dibayar.');
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('answers 404 for a Donation id that does not exist', async () => {
    mockDonationFindUnique.mockResolvedValue(null);

    const response = await POST(retryRequest(), routeContext());

    expect(response.status).toBe(404);
  });

  it("answers 404 for a registered Donor's Donation when the session does not match", async () => {
    mockDonationFindUnique.mockResolvedValue(makeDonation({ donorId: 'owner-1' }));
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else' } });

    const response = await POST(retryRequest(), routeContext());

    expect(response.status).toBe(404);
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('answers 404 for a Guest Donation: the id is not a credential, the result page token is (PR #273 review S2)', async () => {
    mockDonationFindUnique.mockResolvedValue(makeDonation({ donorId: null }));
    mockGetServerSession.mockResolvedValue(null);

    const response = await POST(retryRequest(), routeContext());

    expect(response.status).toBe(404);
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("lets the original Donor retry their own Donation", async () => {
    mockDonationFindUnique.mockResolvedValue(makeDonation({ donorId: 'owner-1' }));
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1' } });

    const response = await POST(retryRequest(), routeContext());

    expect(response.status).toBe(201);
  });

  it('refuses when the Campaign is no longer Active', async () => {
    mockDonationFindUnique.mockResolvedValue(
      makeDonation({ campaign: { ...ACTIVE_CAMPAIGN, lifecycleStatus: 'COMPLETED' } }),
    );

    const response = await POST(retryRequest(), routeContext());

    expect(response.status).toBe(400);
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('refuses a Demo Campaign', async () => {
    mockDonationFindUnique.mockResolvedValue(makeDonation({ campaign: { ...ACTIVE_CAMPAIGN, isDemo: true } }));

    const response = await POST(retryRequest(), routeContext());

    expect(response.status).toBe(403);
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/donations/[id]/retry after an Admin switched provider (prd-compliance 39)', () => {
  const mockSetting = prisma.paymentProviderSetting.findFirst as unknown as Mock;

  afterEach(() => {
    vi.unstubAllEnvs();
    mockSetting.mockResolvedValue(null);
  });

  it('retries through the newly chosen provider, recording it on the new Payment; the old Payment keeps its own provider', async () => {
    mockSetting.mockResolvedValue({ provider: 'mock', methods: ['bank_transfer_va'] });
    mockDonationFindUnique.mockResolvedValue(makeDonation({ paymentMethod: 'bank_transfer' }));
    const createCharge = vi.fn().mockResolvedValue({
      providerOrderId: 'x',
      method: 'bank_transfer_va',
      vaNumber: '8800123',
      expiresAt: new Date('2099-01-02T00:00:00.000Z'),
    });
    mockGetPaymentProvider.mockImplementation((name?: string) =>
      name === 'mock'
        ? { name: 'mock', method: 'bank_transfer_va', createCharge }
        : (() => {
            throw new Error(`unexpected provider ${name}`);
          })(),
    );

    const response = await POST(retryRequest(), routeContext());

    expect(response.status).toBe(201);
    expect(mockGetPaymentProvider).toHaveBeenCalledWith('mock');
    expect(createCharge).toHaveBeenCalledWith(expect.objectContaining({ method: 'bank_transfer_va' }));
    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ provider: 'mock', method: 'bank_transfer_va' }),
    });
    // Settlement of the earlier sumopod Payment is the webhook's job and is
    // pinned there (webhooks/[provider]/route.test.ts): it never reads the setting.
    expect(mockPaymentUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ provider: expect.anything() }) }),
    );
  });

  it.each([
    ['the mock', { provider: 'mock', methods: ['bank_transfer_va'] }, {}],
    [
      'a sandbox',
      { provider: 'sumopod', methods: ['qris_redirect'] },
      { SUMOPOD_BASE_URL: 'https://api-pay-sandbox.sumopod.com/api/v1' },
    ],
  ])('answers 503 and charges nothing in production when the Admin chose %s', async (_label, row, env) => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    mockSetting.mockResolvedValue(row);
    const createCharge = vi.fn();
    mockGetPaymentProvider.mockReturnValue({ name: row.provider, method: 'qris_redirect', createCharge });

    const response = await POST(retryRequest(), routeContext());

    expect(response.status).toBe(503);
    expect(createCharge).not.toHaveBeenCalled();
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });
});
