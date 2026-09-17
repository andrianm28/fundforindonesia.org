import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findUnique: vi.fn(),
    },
    prayer: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

// Mock the payment provider. The real MockPaymentProvider is exercised in
// src/lib/payments/mock-provider.test.ts -- this route only needs to prove it
// calls createCharge and uses what comes back.
vi.mock('@/lib/payments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments')>('@/lib/payments');
  return {
    ...actual,
    getPaymentProvider: vi.fn(),
  };
});

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider, PaymentProviderNotConfiguredError } from '@/lib/payments';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockPrayerCreate = prisma.prayer.create as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockGetPaymentProvider = getPaymentProvider as unknown as Mock;

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/donations', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fake tx client backing the donation + payment creation. */
function makeTx(donation: Record<string, unknown>) {
  const donationCreate = vi.fn().mockResolvedValue(donation);
  const paymentCreate = vi.fn().mockResolvedValue({ id: 'payment-1' });
  return {
    tx: {
      donation: { create: donationCreate },
      payment: { create: paymentCreate },
    },
    donationCreate,
    paymentCreate,
  };
}

const VA_EXPIRY = new Date('2099-01-02T00:00:00.000Z');

function mockChargeResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    providerOrderId: 'donation-1',
    method: 'bank_transfer_va' as const,
    vaNumber: '8808123456789',
    expiresAt: VA_EXPIRY,
    ...overrides,
  };
}

describe('POST /api/donations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Test User', email: 'test@test.com', isVerified: true, verificationType: 'ktp' },
      expires: '2099-01-01',
    });
    mockGetPaymentProvider.mockReturnValue({
      createCharge: vi.fn().mockResolvedValue(mockChargeResult()),
    });
  });

  const validBody = {
    campaignId: 'campaign-1',
    amount: 50000,
    paymentMethod: 'bank_transfer',
    message: 'Semoga cepat sembuh',
    isAnonymous: false,
  };

  it('should create a donation and a Payment, and return 201 with the real VA number', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      title: 'Test Campaign',
    });

    const donation = {
      id: 'donation-1',
      amount: 50000,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'pending',
      isAnonymous: false,
      message: 'Semoga cepat sembuh',
      campaignId: 'campaign-1',
      donorId: 'user-1',
      createdAt: new Date(),
    };
    const { tx, paymentCreate } = makeTx(donation);
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(tx));

    mockPrayerCreate.mockResolvedValue({});

    const request = createRequest(validBody);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.donationId).toBe('donation-1');
    expect(data.amount).toBe(50000);
    expect(data.paymentMethod).toBe('bank_transfer');
    expect(data.paymentStatus).toBe('pending');
    expect(data.campaignTitle).toBe('Test Campaign');
    expect(data.paymentInstructions).toEqual({
      type: 'bank_transfer',
      vaNumber: '8808123456789',
      expiresAt: VA_EXPIRY.toISOString(),
    });

    // The Payment row is created inside the same transaction as the Donation,
    // in PENDING, with providerRef set to the donation id -- the value the
    // webhook (M5) will look it up by.
    expect(paymentCreate).toHaveBeenCalledWith({
      data: {
        donationId: 'donation-1',
        provider: 'mock',
        method: 'bank_transfer_va',
        providerRef: 'donation-1',
        amount: 50000,
        status: 'PENDING',
        expiresAt: VA_EXPIRY,
      },
    });
  });

  it('should create a prayer record when message is provided', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      title: 'Test Campaign',
    });

    const donation = {
      id: 'donation-1',
      amount: 50000,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'pending',
      isAnonymous: false,
      message: 'Semoga cepat sembuh',
      campaignId: 'campaign-1',
      donorId: 'user-1',
      createdAt: new Date(),
    };
    const { tx } = makeTx(donation);
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(tx));
    mockPrayerCreate.mockResolvedValue({});

    const request = createRequest(validBody);
    await POST(request);

    expect(mockPrayerCreate).toHaveBeenCalledWith({
      data: {
        text: 'Semoga cepat sembuh',
        donationId: 'donation-1',
        campaignId: 'campaign-1',
        userId: 'user-1',
      },
    });
  });

  it('should NOT create a prayer record when no message is provided', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      title: 'Test Campaign',
    });

    const donation = {
      id: 'donation-1',
      amount: 50000,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'pending',
      isAnonymous: false,
      message: null,
      campaignId: 'campaign-1',
      donorId: 'user-1',
      createdAt: new Date(),
    };
    const { tx } = makeTx(donation);
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(tx));

    const request = createRequest({
      campaignId: 'campaign-1',
      amount: 50000,
      paymentMethod: 'bank_transfer',
    });
    await POST(request);

    expect(mockPrayerCreate).not.toHaveBeenCalled();
  });

  it('should return 400 when amount is below minimum (1000)', async () => {
    const request = createRequest({
      ...validBody,
      amount: 500,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Validasi gagal');
    expect(data.fieldErrors.amount).toBeDefined();
  });

  it('should return 400 when paymentMethod is invalid', async () => {
    const request = createRequest({
      ...validBody,
      paymentMethod: 'bitcoin',
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Validasi gagal');
    expect(data.fieldErrors.paymentMethod).toBeDefined();
  });

  it('should return 400 when campaignId is missing', async () => {
    const request = createRequest({
      amount: 50000,
      paymentMethod: 'bank_transfer',
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Validasi gagal');
    expect(data.fieldErrors.campaignId).toBeDefined();
  });

  it('should return 404 when campaign does not exist', async () => {
    mockCampaignFindUnique.mockResolvedValue(null);

    const request = createRequest(validBody);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Campaign tidak ditemukan');
  });

  it('should return 400 when campaign is not active', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'completed',
      title: 'Completed Campaign',
      isDemo: false,
    });

    const request = createRequest(validBody);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('tidak aktif');
  });

  it('should return 403 for a demo campaign and write nothing -- not a Donation, not a Payment, and never call the provider', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      title: 'Demo Campaign',
      isDemo: true,
    });
    const chargeCreate = vi.fn();
    mockGetPaymentProvider.mockReturnValue({ createCharge: chargeCreate });

    const request = createRequest(validBody);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toMatch(/contoh/i);
    // Refused before the transaction is ever opened -- no Donation, no
    // Payment, and the provider was never asked for a charge.
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(chargeCreate).not.toHaveBeenCalled();
    expect(mockPrayerCreate).not.toHaveBeenCalled();
  });

  it('should allow anonymous donation (no session)', async () => {
    mockGetServerSession.mockResolvedValue(null);

    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      title: 'Test Campaign',
    });

    const donation = {
      id: 'donation-2',
      amount: 10000,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'pending',
      isAnonymous: true,
      message: null,
      campaignId: 'campaign-1',
      donorId: null,
      createdAt: new Date(),
    };
    const { tx, donationCreate } = makeTx(donation);
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(tx));

    const request = createRequest({
      campaignId: 'campaign-1',
      amount: 10000,
      paymentMethod: 'bank_transfer',
      isAnonymous: true,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.donationId).toBe('donation-2');

    // Verify donorId was null in the create call
    expect(donationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          donorId: null,
        }),
      })
    );
  });

  it('should return 503 for ewallet -- there is no provider integration for it yet', async () => {
    const request = createRequest({
      ...validBody,
      paymentMethod: 'ewallet',
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(typeof data.error).toBe('string');
    expect(data.error.length).toBeGreaterThan(0);
    // No campaign lookup, no charge, no donation -- rejected before any of it.
    expect(mockCampaignFindUnique).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('should return 503 for credit_card -- there is no provider integration for it yet', async () => {
    const request = createRequest({
      ...validBody,
      paymentMethod: 'credit_card',
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(typeof data.error).toBe('string');
    expect(data.error.length).toBeGreaterThan(0);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('should return 503 when the payment provider is not configured', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      title: 'Test Campaign',
    });
    mockGetPaymentProvider.mockImplementation(() => {
      throw new PaymentProviderNotConfiguredError('MOCK_MIDTRANS_SERVER_KEY');
    });

    const request = createRequest(validBody);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(typeof data.error).toBe('string');
    // Nothing was written: the provider check happens before the transaction.
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('should default isAnonymous to false when not provided', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      title: 'Test Campaign',
    });

    const donation = {
      id: 'donation-5',
      amount: 50000,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'pending',
      isAnonymous: false,
      message: null,
      campaignId: 'campaign-1',
      donorId: 'user-1',
      createdAt: new Date(),
    };
    const { tx, donationCreate } = makeTx(donation);
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(tx));

    const request = createRequest({
      campaignId: 'campaign-1',
      amount: 50000,
      paymentMethod: 'bank_transfer',
    });
    await POST(request);

    expect(donationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isAnonymous: false,
        }),
      })
    );
  });
});
