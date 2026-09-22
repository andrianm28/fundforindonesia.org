import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findUnique: vi.fn(),
    },
    donation: {
      create: vi.fn(),
    },
    prayer: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      findUnique: vi.fn(),
    },
    webhookEvent: {
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    notification: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/payments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments')>('@/lib/payments');
  return {
    ...actual,
    getPaymentProvider: vi.fn(),
  };
});

// The route is gated shut in production (donationsEnabled() reads
// NEXT_PUBLIC_DONATIONS_ENABLED, unset in test) and these tests must reach
// past that flag WITHOUT flipping the real switch: mock the module as an
// importActual spread with only donationsEnabled overridden, so the real
// disabled message and every other export -- including
// sandboxInProductionReason, whose real implementation already returns null
// outside NODE_ENV=production -- stay exactly as shipped.
vi.mock('@/lib/donations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/donations')>('@/lib/donations');
  return {
    ...actual,
    donationsEnabled: () => true,
  };
});

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider } from '@/lib/payments';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockGetPaymentProvider = getPaymentProvider as unknown as Mock;

function donateRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/donations', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const VALID_BODY = {
  campaignId: 'campaign-1',
  amount: 50000,
  paymentMethod: 'bank_transfer',
};

describe('POST /api/donations lifecycle gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' },
    });
    mockGetPaymentProvider.mockReturnValue({
      createCharge: vi.fn().mockResolvedValue({
        providerOrderId: 'order-1',
        method: 'bank_transfer_va',
        vaNumber: '8808123456789',
        expiresAt: new Date('2099-01-02T00:00:00.000Z'),
      }),
    });
  });

  it('the enum governs, not the string: active string with SUSPENDED enum is refused', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      lifecycleStatus: 'SUSPENDED',
      title: 'Bantu Korban Banjir',
      isDemo: false,
    });

    const response = await POST(donateRequest(VALID_BODY));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe(
      'Campaign tidak aktif. Hanya campaign aktif yang dapat menerima donasi.'
    );
    expect(mockGetPaymentProvider).not.toHaveBeenCalled();
  });

  it('ACTIVE enum passes the gate and reaches the provider', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      lifecycleStatus: 'ACTIVE',
      title: 'Bantu Korban Banjir',
      isDemo: false,
    });

    await POST(donateRequest(VALID_BODY));

    expect(mockGetPaymentProvider).toHaveBeenCalled();
  });

  describe.each([
    ['SUBMITTED', 'pending'],
    ['REJECTED', 'rejected'],
    ['SUSPENDED', 'suspended'],
    ['CANCELLED', 'active'],
    ['COMPLETED', 'completed'],
    ['EXPIRED', 'expired'],
    ['DRAFT', 'pending'],
  ] as const)('lifecycleStatus %s refuses donations', (lifecycleStatus, status) => {
    it('returns 400 with the unchanged message and never reaches the provider', async () => {
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-1',
        status,
        lifecycleStatus,
        title: 'Bantu Korban Banjir',
        isDemo: false,
      });

      const response = await POST(donateRequest(VALID_BODY));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe(
        'Campaign tidak aktif. Hanya campaign aktif yang dapat menerima donasi.'
      );
      expect(mockGetPaymentProvider).not.toHaveBeenCalled();
    });
  });

  it('the enum governs in reverse: suspended string with ACTIVE enum passes the gate', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'suspended',
      lifecycleStatus: 'ACTIVE',
      title: 'Bantu Korban Banjir',
      isDemo: false,
    });

    await POST(donateRequest(VALID_BODY));

    expect(mockGetPaymentProvider).toHaveBeenCalled();
  });
});
