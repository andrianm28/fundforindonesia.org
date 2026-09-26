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
// src/lib/payments/mock-provider.test.ts -- this route only needs to prove
// (while donations are disabled) that it is never even asked for a charge.
vi.mock('@/lib/payments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments')>('@/lib/payments');
  return {
    ...actual,
    getPaymentProvider: vi.fn(),
  };
});

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider } from '@/lib/payments';

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

const validBody = {
  campaignId: 'campaign-1',
  amount: 50000,
  paymentMethod: 'bank_transfer',
  message: 'Semoga cepat sembuh',
  isAnonymous: false,
};

// Donations are disabled (DONATIONS_ENABLED = false, src/lib/donations.ts):
// getPaymentProvider() resolves to MockPaymentProvider, which fabricates a VA
// number no bank issued and no donor can actually pay -- the only thing that
// stopped a real donor from hitting this before was every existing campaign
// being flagged isDemo. This endpoint must now refuse every request, before
// touching the session, the body, or the database, and it must never create a
// Donation or a Payment, or ask the provider for a charge, while disabled.
describe('POST /api/donations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Test User', email: 'test@test.com', isVerified: true, verificationType: 'ktp' },
      expires: '2099-01-01',
    });
    mockGetPaymentProvider.mockReturnValue({
      createCharge: vi.fn().mockResolvedValue({
        providerOrderId: 'donation-1',
        method: 'bank_transfer_va' as const,
        vaNumber: '8808123456789',
        expiresAt: new Date('2099-01-02T00:00:00.000Z'),
      }),
    });
  });

  it('returns 503 even for a valid, well-formed donation', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      title: 'Test Campaign',
      isDemo: false,
    });

    const request = createRequest(validBody);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(typeof data.error).toBe('string');
    expect(data.error.length).toBeGreaterThan(0);
  });

  it('returns 503 without ever reading the session', async () => {
    const request = createRequest(validBody);
    await POST(request);

    expect(mockGetServerSession).not.toHaveBeenCalled();
  });

  it('returns 503 for a malformed body, without ever validating it', async () => {
    const request = createRequest({ amount: 'not-a-number' });
    const response = await POST(request);

    expect(response.status).toBe(503);
  });

  it('returns 503 without ever looking up the campaign', async () => {
    const request = createRequest(validBody);
    await POST(request);

    expect(mockCampaignFindUnique).not.toHaveBeenCalled();
  });

  it('never creates a Donation, a Payment, or a charge while disabled', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      title: 'Test Campaign',
      isDemo: false,
    });

    const request = createRequest(validBody);
    await POST(request);

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockGetPaymentProvider).not.toHaveBeenCalled();
    expect(mockPrayerCreate).not.toHaveBeenCalled();
  });

  it('returns 503 regardless of payment method, including ones with no provider integration', async () => {
    for (const paymentMethod of ['bank_transfer', 'ewallet', 'credit_card']) {
      const request = createRequest({ ...validBody, paymentMethod });
      const response = await POST(request);

      expect(response.status).toBe(503);
    }
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
