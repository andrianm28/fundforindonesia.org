import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The donation path with the gate open.
 *
 * route.test.ts covers the closed gate and proves nothing downstream runs
 * while DONATIONS_ENABLED is false. Everything past that gate had no test at
 * all, which was tolerable only while the gate could never open. It is about
 * to, against a real provider, so the behaviour it depends on is pinned here.
 */

const mockSandboxReason = vi.fn<() => string | null>(() => null);
vi.mock('@/lib/donations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/donations')>('@/lib/donations');
  return {
    ...actual,
    donationsEnabled: () => true,
    sandboxInProductionReason: () => mockSandboxReason(),
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    donation: { create: vi.fn(), update: vi.fn() },
    paymentProviderSetting: { findFirst: vi.fn().mockResolvedValue(null) },
    payment: { create: vi.fn() },
    chargeWriteFailure: { create: vi.fn() },
    prayer: { create: vi.fn() },
    platformFeeRule: { findFirst: vi.fn() },
    platformFeeThreshold: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));

vi.mock('@/lib/payments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments')>('@/lib/payments');
  return { ...actual, getPaymentProvider: vi.fn() };
});

import { POST } from './route';
import { readDonationGuestEmail, readDonationGuestPhone } from '@/lib/contact-fields';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider, PaymentProviderNotConfiguredError } from '@/lib/payments';
import { CampaignStatus } from '@/generated/prisma/client';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockDonationCreate = prisma.donation.create as unknown as Mock;
const mockDonationUpdate = prisma.donation.update as unknown as Mock;
const mockPaymentCreate = prisma.payment.create as unknown as Mock;
const mockChargeWriteFailureCreate = prisma.chargeWriteFailure.create as unknown as Mock;
const mockPrayerCreate = prisma.prayer.create as unknown as Mock;
const mockPlatformFeeRuleFindFirst = prisma.platformFeeRule.findFirst as unknown as Mock;
const mockPlatformFeeThresholdFindFirst = prisma.platformFeeThreshold.findFirst as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockGetPaymentProvider = getPaymentProvider as unknown as Mock;

/** Records the order in which the route touches the world. */
let callOrder: string[];

/** QRIS_BODY without its guestEmail, for the signed-in / no-email cases. */
function withoutGuestEmail(): Omit<typeof QRIS_BODY, 'guestEmail'> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(QRIS_BODY)) {
    if (key !== 'guestEmail') rest[key] = value;
  }
  return rest as Omit<typeof QRIS_BODY, 'guestEmail'>;
}

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/donations', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const QRIS_BODY = {
  campaignId: 'campaign-1',
  amount: 50_000,
  paymentMethod: 'qris',
  isAnonymous: false,
  // A Guest Donor's minimum data for a Receipt (CONTEXT.md, Guest Donor;
  // prd-compliance 18). mockGetServerSession resolves null by default, so
  // every test below is a Guest Donor unless it sets a session itself.
  guestEmail: 'donor@example.com',
};

function sumopodLike(overrides: Record<string, unknown> = {}) {
  return {
    name: 'sumopod',
    method: 'qris_redirect' as const,
    createCharge: vi.fn(async () => {
      callOrder.push('createCharge');
      return {
        providerOrderId: 'donation-1',
        method: 'qris_redirect' as const,
        redirectUrl: 'https://pay.sumopod.com/pay/abc',
        expiresAt: new Date('2026-09-20T12:00:00.000Z'),
      };
    }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSandboxReason.mockReturnValue(null);
  callOrder = [];
  mockGetServerSession.mockResolvedValue(null);
  mockCampaignFindUnique.mockResolvedValue({
    id: 'campaign-1',
    lifecycleStatus: CampaignStatus.ACTIVE,
    title: 'Bantu Korban Banjir',
    isDemo: false,
    kind: 'DONATION',
    category: 'kesehatan',
    // A Collecting Entity with a permit valid now (prd-compliance 10).
    collectingEntity: { permits: [{ kinds: ['DONATION'], validFrom: new Date('2020-01-01T00:00:00Z'), validTo: new Date('2099-12-31T00:00:00Z') }] },
  });
  mockDonationCreate.mockImplementation(async () => {
    callOrder.push('donation.create');
    return { id: 'donation-1', amount: 50_000, paymentMethod: 'qris', paymentStatus: 'pending' };
  });
  mockDonationUpdate.mockResolvedValue({});
  mockPaymentCreate.mockImplementation(async () => {
    callOrder.push('payment.create');
    return {};
  });
  mockPrayerCreate.mockResolvedValue({});
  mockChargeWriteFailureCreate.mockResolvedValue({});
  mockGetPaymentProvider.mockReset();
  mockGetPaymentProvider.mockReturnValue(sumopodLike());
  (prisma.paymentProviderSetting.findFirst as unknown as Mock).mockResolvedValue(null);
  // No Platform Fee rule or threshold configured by default -- resolves to
  // 0 bps / 0 threshold (prd-compliance 17), never an invented rate.
  mockPlatformFeeRuleFindFirst.mockResolvedValue(null);
  mockPlatformFeeThresholdFindFirst.mockResolvedValue(null);
});

describe('POST /api/donations charging through QRIS', () => {
  it('accepts qris as a payment method', async () => {
    const response = await POST(createRequest(QRIS_BODY));

    expect(response.status).toBe(201);
  });

  it('returns the hosted payment link the donor must be sent to', async () => {
    const response = await POST(createRequest(QRIS_BODY));
    const data = await response.json();

    expect(data.paymentInstructions).toEqual({
      type: 'qris',
      redirectUrl: 'https://pay.sumopod.com/pay/abc',
      expiresAt: '2026-09-20T12:00:00.000Z',
    });
  });

  it('records the Payment against the provider that actually issued it', async () => {
    // Hardcoding 'mock' here made every Payment claim it came from the mock,
    // which makes per-provider reconciliation compare the wrong rows.
    await POST(createRequest(QRIS_BODY));

    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'sumopod',
        method: 'qris_redirect',
        providerRef: 'donation-1',
        donationId: 'donation-1',
        amount: 50_000,
      }),
    });
  });
});

describe('POST /api/donations not holding a transaction across the provider call', () => {
  it('commits the Donation before calling the provider, and writes the Payment after', async () => {
    // The old code charged inside prisma.$transaction, which holds a pooled
    // connection and row locks for the length of an HTTP round trip. Against
    // a mock that was free; against a real provider it is how one slow
    // response exhausts the pool and takes the site down.
    await POST(createRequest(QRIS_BODY));

    expect(callOrder).toEqual(['donation.create', 'createCharge', 'payment.create']);
  });

  it('never opens a database transaction around the provider call', async () => {
    await POST(createRequest(QRIS_BODY));

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('POST /api/donations when the provider cannot serve the chosen method', () => {
  it('refuses before any charge exists at the provider', async () => {
    // Asked before charging, not after: a charge created and then abandoned
    // is a payment link a donor could still find and pay into.
    const provider = sumopodLike();
    mockGetPaymentProvider.mockReturnValue(provider);

    const response = await POST(
      createRequest({ ...QRIS_BODY, paymentMethod: 'bank_transfer' }),
    );

    expect(response.status).toBe(503);
    expect(provider.createCharge).not.toHaveBeenCalled();
    expect(mockDonationCreate).not.toHaveBeenCalled();
  });

  it('still refuses methods no provider implements at all', async () => {
    const response = await POST(createRequest({ ...QRIS_BODY, paymentMethod: 'credit_card' }));

    expect(response.status).toBe(503);
    expect(mockDonationCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/donations through a provider an Admin switched on (prd-compliance 39)', () => {
  const mockSettingFindFirst = prisma.paymentProviderSetting.findFirst as unknown as Mock;

  function twoMethodProvider() {
    return sumopodLike({
      name: 'sumopod',
      supportedMethods: ['qris_redirect', 'ewallet_redirect'],
      createCharge: vi.fn(async (input: { method?: string }) => ({
        providerOrderId: 'donation-1',
        method: input.method,
        redirectUrl: 'https://pay.sumopod.com/pay/abc',
        expiresAt: new Date('2026-09-20T12:00:00.000Z'),
      })),
    });
  }

  it('charges an e-wallet when the Admin enabled it, recording the provider and method on the Payment', async () => {
    const provider = twoMethodProvider();
    mockGetPaymentProvider.mockReturnValue(provider);
    mockSettingFindFirst.mockResolvedValue({ provider: 'sumopod', methods: ['qris_redirect', 'ewallet_redirect'] });

    const response = await POST(createRequest({ ...QRIS_BODY, paymentMethod: 'ewallet' }));

    expect(response.status).toBe(201);
    expect(mockGetPaymentProvider).toHaveBeenCalledWith('sumopod');
    expect(provider.createCharge).toHaveBeenCalledWith(expect.objectContaining({ method: 'ewallet_redirect' }));
    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ provider: 'sumopod', method: 'ewallet_redirect', providerRef: 'donation-1' }),
    });
    expect((await response.json()).paymentInstructions).toMatchObject({ type: 'ewallet' });
  });

  it('refuses a method the provider supports but the Admin left off, before any charge exists', async () => {
    const provider = twoMethodProvider();
    mockGetPaymentProvider.mockReturnValue(provider);
    mockSettingFindFirst.mockResolvedValue({ provider: 'sumopod', methods: ['qris_redirect'] });

    const response = await POST(createRequest({ ...QRIS_BODY, paymentMethod: 'ewallet' }));

    expect(response.status).toBe(503);
    expect(provider.createCharge).not.toHaveBeenCalled();
    expect(mockDonationCreate).not.toHaveBeenCalled();
  });

  it('answers 503, writing nothing, when the Admin chose a provider this server has no credentials for', async () => {
    mockSettingFindFirst.mockResolvedValue({ provider: 'sumopod', methods: ['qris_redirect'] });
    mockGetPaymentProvider.mockImplementation(() => {
      throw new PaymentProviderNotConfiguredError('SUMOPOD_API_KEY');
    });

    const response = await POST(createRequest(QRIS_BODY));

    expect(response.status).toBe(503);
    expect(mockDonationCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/donations in production with an Admin choice that may not take money (prd-compliance 39)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['the mock', { provider: 'mock', methods: ['bank_transfer_va'] }, {}],
    [
      'a sandbox',
      { provider: 'sumopod', methods: ['qris_redirect'] },
      { SUMOPOD_BASE_URL: 'https://api-pay-sandbox.sumopod.com/api/v1' },
    ],
  ])('answers 503, writing nothing and charging nothing, when the Admin chose %s', async (_label, row, env) => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    (prisma.paymentProviderSetting.findFirst as unknown as Mock).mockResolvedValue(row);
    const provider = sumopodLike();
    mockGetPaymentProvider.mockReturnValue(provider);

    const response = await POST(createRequest(QRIS_BODY));

    expect(response.status).toBe(503);
    expect(provider.createCharge).not.toHaveBeenCalled();
    expect(mockDonationCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/donations when the charge fails', () => {
  it('marks the donation failed rather than leaving it pending forever', async () => {
    // The Donation is already committed by then. Left at 'pending' it would
    // sit in the donor's history as an unfinished payment they can neither
    // complete nor understand.
    mockGetPaymentProvider.mockReturnValue(
      sumopodLike({ createCharge: vi.fn().mockRejectedValue(new Error('provider down')) }),
    );

    const response = await POST(createRequest(QRIS_BODY));

    expect(response.status).toBe(503);
    expect(mockDonationUpdate).toHaveBeenCalledWith({
      where: { id: 'donation-1' },
      data: { paymentStatus: 'failed' },
    });
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('records a ChargeWriteFailure and answers 503 when the charge succeeded but the Payment write failed (ticket 52)', async () => {
    // The provider now holds a live charge this database has no Payment for.
    // It must be findable for reconciliation, not vanish into a bare 500.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockPaymentCreate.mockRejectedValue(new Error('connection reset by donor@example.com'));

      const response = await POST(createRequest(QRIS_BODY));

      expect(response.status).toBe(503);
      expect(mockChargeWriteFailureCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          provider: 'sumopod',
          providerRef: 'donation-1',
          subjectType: 'donation',
          subjectId: 'donation-1',
          amount: 50_000,
        }),
      });
      const recorded = JSON.stringify(mockChargeWriteFailureCreate.mock.calls);
      expect(recorded).not.toContain('donor@example.com');
      expect(mockDonationUpdate).toHaveBeenCalledWith({
        where: { id: 'donation-1' },
        data: { paymentStatus: 'failed' },
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses a charge whose method is not the one the provider declared', async () => {
    // A provider answering with a shape the route did not prepare for must
    // fail loudly, not write a Payment with no way to pay it.
    mockGetPaymentProvider.mockReturnValue(
      sumopodLike({
        createCharge: vi.fn().mockResolvedValue({
          providerOrderId: 'donation-1',
          method: 'bank_transfer_va' as const,
          vaNumber: '8808123456789',
          expiresAt: new Date(),
        }),
      }),
    );

    const response = await POST(createRequest(QRIS_BODY));

    expect(response.status).toBe(503);
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/donations guards that must survive the gate opening', () => {
  it('still refuses a demo campaign', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      lifecycleStatus: CampaignStatus.ACTIVE,
      title: 'Contoh',
      isDemo: true,
    });

    const response = await POST(createRequest(QRIS_BODY));

    expect(response.status).toBe(403);
    expect(mockDonationCreate).not.toHaveBeenCalled();
  });

  it('still refuses an inactive campaign', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      lifecycleStatus: CampaignStatus.COMPLETED,
      title: 'Selesai',
      isDemo: false,
    });

    const response = await POST(createRequest(QRIS_BODY));

    expect(response.status).toBe(400);
    expect(mockDonationCreate).not.toHaveBeenCalled();
  });

  // The guest email is sealed on the way in and the plaintext column is gone
  // (ADR 0012), so what the write carries is the protected form -- read back
  // through the same decrypt a Receipt uses to address the Donor.
  it('lets a guest donate without a session, keeping the guest email it left as a sealed form', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await POST(createRequest(QRIS_BODY));

    expect(response.status).toBe(201);
    const { data } = mockDonationCreate.mock.calls[0]![0]!;
    expect(data).toMatchObject({ donorId: null });
    expect(data).not.toHaveProperty('guestEmail');
    expect(readDonationGuestEmail(data)).toBe('donor@example.com');
  });

  it('records a prayer when the donor left a message', async () => {
    await POST(createRequest({ ...QRIS_BODY, message: 'Semoga lekas pulih' }));

    expect(mockPrayerCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ text: 'Semoga lekas pulih', donationId: 'donation-1' }),
    });
  });
});

describe('POST /api/donations resolving and freezing the Platform Fee (prd-compliance 17)', () => {
  it('freezes platformFee 0 on the Payment when no rule and no threshold are configured', async () => {
    await POST(createRequest(QRIS_BODY));

    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ platformFee: 0 }),
    });
  });

  it('applies the Kind default rate, rounded down', async () => {
    mockPlatformFeeRuleFindFirst.mockImplementation(async ({ where }: { where: { scope: string } }) =>
      where.scope === 'KIND' ? { percentBps: 250, kind: 'DONATION', scope: 'KIND' } : null,
    );

    // 2.5% of 50_000 = 1_250 exactly.
    await POST(createRequest(QRIS_BODY));

    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ platformFee: 1_250 }),
    });
  });

  it('prefers a Category override over the Kind default', async () => {
    mockPlatformFeeRuleFindFirst.mockImplementation(async ({ where }: { where: { scope: string } }) => {
      if (where.scope === 'KIND') return { percentBps: 250, scope: 'KIND' };
      if (where.scope === 'CATEGORY') return { percentBps: 400, scope: 'CATEGORY' };
      return null;
    });

    await POST(createRequest(QRIS_BODY));

    // 4% of 50_000 = 2_000.
    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ platformFee: 2_000 }),
    });
  });

  it('prefers a Campaign override over both Category and Kind', async () => {
    mockPlatformFeeRuleFindFirst.mockImplementation(async ({ where }: { where: { scope: string } }) => {
      if (where.scope === 'KIND') return { percentBps: 250, scope: 'KIND' };
      if (where.scope === 'CATEGORY') return { percentBps: 400, scope: 'CATEGORY' };
      if (where.scope === 'CAMPAIGN') return { percentBps: 100, scope: 'CAMPAIGN' };
      return null;
    });

    await POST(createRequest(QRIS_BODY));

    // 1% of 50_000 = 500.
    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ platformFee: 500 }),
    });
  });

  it('waives the fee entirely below the Admin-set threshold', async () => {
    mockPlatformFeeRuleFindFirst.mockImplementation(async ({ where }: { where: { scope: string } }) =>
      where.scope === 'KIND' ? { percentBps: 250, scope: 'KIND' } : null,
    );
    mockPlatformFeeThresholdFindFirst.mockResolvedValue({ amount: 50_001 });

    // amount (50_000) is below the threshold (50_001).
    await POST(createRequest(QRIS_BODY));

    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ platformFee: 0 }),
    });
  });

  it('charges the fee once the amount reaches the threshold', async () => {
    mockPlatformFeeRuleFindFirst.mockImplementation(async ({ where }: { where: { scope: string } }) =>
      where.scope === 'KIND' ? { percentBps: 250, scope: 'KIND' } : null,
    );
    mockPlatformFeeThresholdFindFirst.mockResolvedValue({ amount: 50_000 });

    await POST(createRequest(QRIS_BODY));

    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ platformFee: 1_250 }),
    });
  });
});

describe('POST /api/donations Guest Donor contact details (prd-compliance 18)', () => {
  it('refuses a session-less donation with no guest email, before anything is written', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const bodyWithoutEmail = withoutGuestEmail();

    const response = await POST(createRequest(bodyWithoutEmail));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Email harus diisi untuk donasi tanpa akun');
    expect(mockDonationCreate).not.toHaveBeenCalled();
  });

  it('rejects a malformed guest email as a validation error, not the "email required" one', async () => {
    const response = await POST(createRequest({ ...QRIS_BODY, guestEmail: 'not-an-email' }));

    expect(response.status).toBe(400);
    expect(mockDonationCreate).not.toHaveBeenCalled();
  });

  it('does not require a guest email for a signed-in Donor', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' } });
    const bodyWithoutEmail = withoutGuestEmail();

    const response = await POST(createRequest(bodyWithoutEmail));

    expect(response.status).toBe(201);
    // A signed-in Donor's contact lives on their User row, so no guest contact
    // is sealed onto the Donation at all.
    const { data } = mockDonationCreate.mock.calls[0]![0]!;
    expect(data).not.toHaveProperty('guestEmailHmac');
    expect(data).not.toHaveProperty('guestEmailCiphertext');
  });

  it('keeps the optional guest name in the clear and the phone sealed, beside the sealed email', async () => {
    await POST(
      createRequest({ ...QRIS_BODY, guestName: 'Tamu Baik', guestPhone: '081200000000' }),
    );

    const { data } = mockDonationCreate.mock.calls[0]![0]!;
    // The name is plaintext by decision (ADR 0012, like User.name); the phone
    // is a ciphertext, as it is everywhere.
    expect(data.guestName).toBe('Tamu Baik');
    expect(readDonationGuestEmail(data)).toBe('donor@example.com');
    expect(readDonationGuestPhone(data)).toBe('081200000000');
  });
});

describe('POST /api/donations minimum amount (prd-compliance 18)', () => {
  it('refuses an amount below Rp20.000', async () => {
    const response = await POST(createRequest({ ...QRIS_BODY, amount: 19_999 }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.fieldErrors.amount).toBeDefined();
    expect(mockDonationCreate).not.toHaveBeenCalled();
  });

  it('accepts exactly Rp20.000', async () => {
    const response = await POST(createRequest({ ...QRIS_BODY, amount: 20_000 }));

    expect(response.status).toBe(201);
  });
});

describe('POST /api/donations freezes the Escrow Hold duration (prd-compliance 18)', () => {
  it('freezes the live ESCROW_HOLD_DAYS onto the Payment at creation', async () => {
    await POST(createRequest(QRIS_BODY));

    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ escrowHoldDays: 7 }),
    });
  });
});

describe('POST /api/donations Traffic Source (ticket 24)', () => {
  it('records a well-formed trafficSource on the Donation', async () => {
    await POST(createRequest({ ...QRIS_BODY, trafficSource: 'whatsapp' }));

    expect(mockDonationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ trafficSource: 'whatsapp' }),
    });
  });

  it('sanitizes an unsafe trafficSource rather than reflecting it unescaped', async () => {
    await POST(createRequest({ ...QRIS_BODY, trafficSource: '<script>alert(1)</script>' }));

    expect(mockDonationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ trafficSource: 'scriptalert1script' }),
    });
  });

  it('never blocks the donation when trafficSource is absent', async () => {
    const response = await POST(createRequest(QRIS_BODY));

    expect(response.status).toBe(201);
    expect(mockDonationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ trafficSource: null }),
    });
  });

  it('never blocks the donation when trafficSource is malformed (e.g. an object)', async () => {
    const response = await POST(createRequest({ ...QRIS_BODY, trafficSource: { not: 'a string' } }));

    expect(response.status).toBe(201);
    expect(mockDonationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ trafficSource: null }),
    });
  });

  it('caps an overlong trafficSource instead of refusing the donation', async () => {
    const response = await POST(createRequest({ ...QRIS_BODY, trafficSource: 'a'.repeat(500) }));

    expect(response.status).toBe(201);
    expect(mockDonationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ trafficSource: 'a'.repeat(40) }),
    });
  });
});

describe('POST /api/donations refuses a misconfigured environment', () => {
  it('answers 503 and writes nothing when sandbox credentials are live in production', async () => {
    // The switch being on is not enough. Sandbox credentials in production
    // take real rupiah into an account that settles nowhere, and there is no
    // way back from that, so the route refuses even though donations are
    // nominally enabled.
    mockSandboxReason.mockReturnValue('SUMOPOD_BASE_URL points at the Sumopod sandbox in production.');

    const response = await POST(createRequest(QRIS_BODY));

    expect(response.status).toBe(503);
    expect(mockDonationCreate).not.toHaveBeenCalled();
    expect(mockCampaignFindUnique).not.toHaveBeenCalled();
  });
});
