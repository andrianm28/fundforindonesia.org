import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from './route';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    donation: {
      findUnique: vi.fn(),
    },
    notification: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';

const mockDonationFindUnique = prisma.donation.findUnique as unknown as Mock;
const mockNotificationCreateMany = prisma.notification.createMany as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;

function createRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/donations/${id}/confirm`, {
    method: 'PATCH',
  });
}

describe('PATCH /api/donations/[id]/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotificationCreateMany.mockResolvedValue({ count: 2 });
  });

  const mockDonation = {
    id: 'donation-1',
    amount: 50000,
    paymentStatus: 'pending',
    donorId: 'user-1',
    campaignId: 'campaign-1',
    campaign: {
      id: 'campaign-1',
      title: 'Test Campaign',
      targetAmount: 1000000,
      collectedAmount: 200000,
      creatorId: 'creator-1',
    },
    prayer: null,
  };

  it('should confirm a pending donation and return 200', async () => {
    mockDonationFindUnique.mockResolvedValue(mockDonation);
    mockTransaction.mockResolvedValue({
      updatedDonation: { id: 'donation-1', paymentStatus: 'confirmed', amount: 50000 },
      updatedCampaign: { id: 'campaign-1', status: 'active', collectedAmount: 250000 },
    });

    const request = createRequest('donation-1');
    const response = await PATCH(request, { params: { id: 'donation-1' } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.paymentStatus).toBe('confirmed');
    expect(data.amount).toBe(50000);
    expect(data.campaignId).toBe('campaign-1');
    expect(data.collectedAmount).toBe(250000);
  });

  it('should return 404 when donation is not found', async () => {
    mockDonationFindUnique.mockResolvedValue(null);

    const request = createRequest('nonexistent');
    const response = await PATCH(request, { params: { id: 'nonexistent' } });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Donasi tidak ditemukan');
  });

  it('should return 400 when donation is already confirmed', async () => {
    mockDonationFindUnique.mockResolvedValue({
      ...mockDonation,
      paymentStatus: 'confirmed',
    });

    const request = createRequest('donation-1');
    const response = await PATCH(request, { params: { id: 'donation-1' } });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('confirmed');
  });

  it('should return 400 when donation has failed status', async () => {
    mockDonationFindUnique.mockResolvedValue({
      ...mockDonation,
      paymentStatus: 'failed',
    });

    const request = createRequest('donation-1');
    const response = await PATCH(request, { params: { id: 'donation-1' } });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('failed');
  });

  it('should update campaign status to completed when target is met', async () => {
    const donationAtTarget = {
      ...mockDonation,
      amount: 800000,
      campaign: {
        ...mockDonation.campaign,
        collectedAmount: 200000, // 200000 + 800000 = 1000000 >= targetAmount
      },
    };
    mockDonationFindUnique.mockResolvedValue(donationAtTarget);
    mockTransaction.mockResolvedValue({
      updatedDonation: { id: 'donation-1', paymentStatus: 'confirmed', amount: 800000 },
      updatedCampaign: { id: 'campaign-1', status: 'completed', collectedAmount: 1000000 },
    });

    const request = createRequest('donation-1');
    const response = await PATCH(request, { params: { id: 'donation-1' } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.campaignStatus).toBe('completed');
  });

  it('should create notification for donor when donorId is set', async () => {
    mockDonationFindUnique.mockResolvedValue(mockDonation);
    mockTransaction.mockResolvedValue({
      updatedDonation: { id: 'donation-1', paymentStatus: 'confirmed', amount: 50000 },
      updatedCampaign: { id: 'campaign-1', status: 'active', collectedAmount: 250000 },
    });

    const request = createRequest('donation-1');
    await PATCH(request, { params: { id: 'donation-1' } });

    expect(mockNotificationCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          type: 'donation_confirmed',
          userId: 'user-1',
          message: expect.stringContaining('Rp50.000'),
        }),
      ]),
    });
  });

  it('should create notification for campaign creator', async () => {
    mockDonationFindUnique.mockResolvedValue(mockDonation);
    mockTransaction.mockResolvedValue({
      updatedDonation: { id: 'donation-1', paymentStatus: 'confirmed', amount: 50000 },
      updatedCampaign: { id: 'campaign-1', status: 'active', collectedAmount: 250000 },
    });

    const request = createRequest('donation-1');
    await PATCH(request, { params: { id: 'donation-1' } });

    expect(mockNotificationCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          type: 'donation_confirmed',
          userId: 'creator-1',
          message: expect.stringContaining('Test Campaign'),
        }),
      ]),
    });
  });

  it('should NOT create donor notification when donorId is null (anonymous)', async () => {
    const anonDonation = {
      ...mockDonation,
      donorId: null,
    };
    mockDonationFindUnique.mockResolvedValue(anonDonation);
    mockTransaction.mockResolvedValue({
      updatedDonation: { id: 'donation-1', paymentStatus: 'confirmed', amount: 50000 },
      updatedCampaign: { id: 'campaign-1', status: 'active', collectedAmount: 250000 },
    });

    const request = createRequest('donation-1');
    await PATCH(request, { params: { id: 'donation-1' } });

    // Should only have 1 notification (for creator, not donor)
    expect(mockNotificationCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          userId: 'creator-1',
        }),
      ]),
    });

    const callData = mockNotificationCreateMany.mock.calls[0][0].data;
    expect(callData.length).toBe(1);
    expect(callData[0].userId).toBe('creator-1');
  });

  it('should use $transaction for atomic operations', async () => {
    mockDonationFindUnique.mockResolvedValue(mockDonation);
    mockTransaction.mockResolvedValue({
      updatedDonation: { id: 'donation-1', paymentStatus: 'confirmed', amount: 50000 },
      updatedCampaign: { id: 'campaign-1', status: 'active', collectedAmount: 250000 },
    });

    const request = createRequest('donation-1');
    await PATCH(request, { params: { id: 'donation-1' } });

    expect(mockTransaction).toHaveBeenCalled();
  });
});
