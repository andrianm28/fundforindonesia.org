import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

// Mock prisma
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
  },
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockDonationCreate = prisma.donation.create as unknown as Mock;
const mockPrayerCreate = prisma.prayer.create as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/donations', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/donations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Test User', email: 'test@test.com', isVerified: true, verificationType: 'ktp' },
      expires: '2099-01-01',
    });
  });

  const validBody = {
    campaignId: 'campaign-1',
    amount: 50000,
    paymentMethod: 'bank_transfer',
    message: 'Semoga cepat sembuh',
    isAnonymous: false,
  };

  it('should create a donation and return 201 with payment instructions', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      title: 'Test Campaign',
    });

    mockDonationCreate.mockResolvedValue({
      id: 'donation-1',
      amount: 50000,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'pending',
      isAnonymous: false,
      message: 'Semoga cepat sembuh',
      campaignId: 'campaign-1',
      donorId: 'user-1',
      createdAt: new Date(),
    });

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
    expect(data.paymentInstructions).toBeDefined();
    expect(data.paymentInstructions.type).toBe('bank_transfer');
    expect(data.paymentInstructions.bankName).toBe('BCA');
    expect(data.paymentInstructions.vaNumber).toBeDefined();
    expect(data.paymentInstructions.expiry).toBeDefined();
  });

  it('should create a prayer record when message is provided', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      title: 'Test Campaign',
    });

    mockDonationCreate.mockResolvedValue({
      id: 'donation-1',
      amount: 50000,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'pending',
      isAnonymous: false,
      message: 'Semoga cepat sembuh',
      campaignId: 'campaign-1',
      donorId: 'user-1',
      createdAt: new Date(),
    });

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

    mockDonationCreate.mockResolvedValue({
      id: 'donation-1',
      amount: 50000,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'pending',
      isAnonymous: false,
      message: null,
      campaignId: 'campaign-1',
      donorId: 'user-1',
      createdAt: new Date(),
    });

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
    });

    const request = createRequest(validBody);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('tidak aktif');
  });

  it('should allow anonymous donation (no session)', async () => {
    mockGetServerSession.mockResolvedValue(null);

    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      title: 'Test Campaign',
    });

    mockDonationCreate.mockResolvedValue({
      id: 'donation-2',
      amount: 10000,
      paymentMethod: 'ewallet',
      paymentStatus: 'pending',
      isAnonymous: true,
      message: null,
      campaignId: 'campaign-1',
      donorId: null,
      createdAt: new Date(),
    });

    const request = createRequest({
      campaignId: 'campaign-1',
      amount: 10000,
      paymentMethod: 'ewallet',
      isAnonymous: true,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.donationId).toBe('donation-2');

    // Verify donorId was null in the create call
    expect(mockDonationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          donorId: null,
        }),
      })
    );
  });

  it('should return ewallet payment instructions', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      title: 'Test Campaign',
    });

    mockDonationCreate.mockResolvedValue({
      id: 'donation-3',
      amount: 25000,
      paymentMethod: 'ewallet',
      paymentStatus: 'pending',
      isAnonymous: false,
      message: null,
      campaignId: 'campaign-1',
      donorId: 'user-1',
      createdAt: new Date(),
    });

    const request = createRequest({
      ...validBody,
      paymentMethod: 'ewallet',
      message: undefined,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.paymentInstructions.type).toBe('ewallet');
    expect(data.paymentInstructions.deeplink).toContain('gojek://gopay/pay');
    expect(data.paymentInstructions.qrCode).toBeDefined();
  });

  it('should return credit_card payment instructions', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      title: 'Test Campaign',
    });

    mockDonationCreate.mockResolvedValue({
      id: 'donation-4',
      amount: 100000,
      paymentMethod: 'credit_card',
      paymentStatus: 'pending',
      isAnonymous: false,
      message: null,
      campaignId: 'campaign-1',
      donorId: 'user-1',
      createdAt: new Date(),
    });

    const request = createRequest({
      ...validBody,
      paymentMethod: 'credit_card',
      message: undefined,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.paymentInstructions.type).toBe('credit_card');
    expect(data.paymentInstructions.redirectUrl).toContain('/payment/cc/');
  });

  it('should default isAnonymous to false when not provided', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      title: 'Test Campaign',
    });

    mockDonationCreate.mockResolvedValue({
      id: 'donation-5',
      amount: 50000,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'pending',
      isAnonymous: false,
      message: null,
      campaignId: 'campaign-1',
      donorId: 'user-1',
      createdAt: new Date(),
    });

    const request = createRequest({
      campaignId: 'campaign-1',
      amount: 50000,
      paymentMethod: 'bank_transfer',
    });
    await POST(request);

    expect(mockDonationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isAnonymous: false,
        }),
      })
    );
  });
});
