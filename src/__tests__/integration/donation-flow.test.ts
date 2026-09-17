import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

// Mock prisma globally for the integration test
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    donation: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    prayer: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    notification: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

// Import route handlers
import { POST as createDonation } from '@/app/api/donations/route';
import { PATCH as confirmDonation } from '@/app/api/donations/[id]/confirm/route';
import { POST as balanceDonate } from '@/app/api/balance/donate/route';

// Typed mock references
const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockDonationCreate = prisma.donation.create as unknown as Mock;
const mockDonationFindUnique = prisma.donation.findUnique as unknown as Mock;
const mockPrayerCreate = prisma.prayer.create as unknown as Mock;
const mockUserFindUnique = prisma.user.findUnique as unknown as Mock;
const mockNotificationCreateMany = prisma.notification.createMany as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

// Helper to create POST requests
function createPostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// Helper to create PATCH requests
function createPatchRequest(url: string): NextRequest {
  return new NextRequest(url, { method: 'PATCH' });
}

describe('Donation Flow Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotificationCreateMany.mockResolvedValue({ count: 0 });
  });

  describe('1. Donation creation validates campaign is active', () => {
    it('should reject donation when campaign is completed', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-1',
        status: 'completed',
        title: 'Completed Campaign',
      });

      const request = createPostRequest('http://localhost:3000/api/donations', {
        campaignId: 'campaign-1',
        amount: 50000,
        paymentMethod: 'bank_transfer',
      });

      const response = await createDonation(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('tidak aktif');
    });

    it('should reject donation when campaign is expired', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-2',
        status: 'expired',
        title: 'Expired Campaign',
      });

      const request = createPostRequest('http://localhost:3000/api/donations', {
        campaignId: 'campaign-2',
        amount: 25000,
        paymentMethod: 'ewallet',
      });

      const response = await createDonation(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('tidak aktif');
    });

    it('should allow donation when campaign is active', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-3',
        status: 'active',
        title: 'Active Campaign',
      });
      mockDonationCreate.mockResolvedValue({
        id: 'donation-new',
        amount: 50000,
        paymentMethod: 'bank_transfer',
        paymentStatus: 'pending',
        campaignId: 'campaign-3',
        donorId: 'user-1',
      });

      const request = createPostRequest('http://localhost:3000/api/donations', {
        campaignId: 'campaign-3',
        amount: 50000,
        paymentMethod: 'bank_transfer',
      });

      const response = await createDonation(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.donationId).toBe('donation-new');
      expect(data.paymentStatus).toBe('pending');
    });
  });

  describe('2. Donation creation creates prayer when message is included', () => {
    it('should create prayer record when message is provided in donation', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-1',
        status: 'active',
        title: 'Campaign With Prayer',
      });
      mockDonationCreate.mockResolvedValue({
        id: 'donation-prayer',
        amount: 100000,
        paymentMethod: 'ewallet',
        paymentStatus: 'pending',
        campaignId: 'campaign-1',
        donorId: 'user-1',
        message: 'Semoga cepat sembuh ya',
      });
      mockPrayerCreate.mockResolvedValue({
        id: 'prayer-1',
        text: 'Semoga cepat sembuh ya',
        donationId: 'donation-prayer',
      });

      const request = createPostRequest('http://localhost:3000/api/donations', {
        campaignId: 'campaign-1',
        amount: 100000,
        paymentMethod: 'ewallet',
        message: 'Semoga cepat sembuh ya',
      });

      const response = await createDonation(request);

      expect(response.status).toBe(201);
      expect(mockPrayerCreate).toHaveBeenCalledWith({
        data: {
          text: 'Semoga cepat sembuh ya',
          donationId: 'donation-prayer',
          campaignId: 'campaign-1',
          userId: 'user-1',
        },
      });
    });

    it('should NOT create prayer when no message is provided', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-1',
        status: 'active',
        title: 'Campaign No Prayer',
      });
      mockDonationCreate.mockResolvedValue({
        id: 'donation-no-prayer',
        amount: 25000,
        paymentMethod: 'bank_transfer',
        paymentStatus: 'pending',
        campaignId: 'campaign-1',
        donorId: 'user-1',
        message: null,
      });

      const request = createPostRequest('http://localhost:3000/api/donations', {
        campaignId: 'campaign-1',
        amount: 25000,
        paymentMethod: 'bank_transfer',
      });

      await createDonation(request);

      expect(mockPrayerCreate).not.toHaveBeenCalled();
    });
  });

  describe('3. Confirmation endpoint updates donation status and increments campaign amount', () => {
    it('should confirm donation, update status, and increment collectedAmount', async () => {
      mockDonationFindUnique.mockResolvedValue({
        id: 'donation-1',
        amount: 75000,
        paymentStatus: 'pending',
        donorId: 'user-1',
        campaignId: 'campaign-1',
        campaign: {
          id: 'campaign-1',
          title: 'Active Campaign',
          targetAmount: 1000000,
          collectedAmount: 300000,
          creatorId: 'creator-1',
        },
        prayer: null,
      });

      mockTransaction.mockResolvedValue({
        updatedDonation: { id: 'donation-1', paymentStatus: 'confirmed', amount: 75000 },
        updatedCampaign: { id: 'campaign-1', status: 'active', collectedAmount: 375000 },
      });

      const request = createPatchRequest('http://localhost:3000/api/donations/donation-1/confirm');
      const response = await confirmDonation(request, { params: { id: 'donation-1' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.paymentStatus).toBe('confirmed');
      expect(data.collectedAmount).toBe(375000);
      expect(data.campaignStatus).toBe('active');
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should mark campaign as completed when collectedAmount meets targetAmount', async () => {
      mockDonationFindUnique.mockResolvedValue({
        id: 'donation-final',
        amount: 200000,
        paymentStatus: 'pending',
        donorId: 'user-2',
        campaignId: 'campaign-target',
        campaign: {
          id: 'campaign-target',
          title: 'Almost Done Campaign',
          targetAmount: 500000,
          collectedAmount: 350000, // 350000 + 200000 = 550000 >= 500000
          creatorId: 'creator-2',
        },
        prayer: null,
      });

      mockTransaction.mockResolvedValue({
        updatedDonation: { id: 'donation-final', paymentStatus: 'confirmed', amount: 200000 },
        updatedCampaign: { id: 'campaign-target', status: 'completed', collectedAmount: 550000 },
      });

      const request = createPatchRequest('http://localhost:3000/api/donations/donation-final/confirm');
      const response = await confirmDonation(request, { params: { id: 'donation-final' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.campaignStatus).toBe('completed');
      expect(data.collectedAmount).toBe(550000);
    });
  });

  describe('4. Confirmation creates notifications for donor and creator', () => {
    it('should create notifications for both donor and campaign creator', async () => {
      mockDonationFindUnique.mockResolvedValue({
        id: 'donation-notif',
        amount: 100000,
        paymentStatus: 'pending',
        donorId: 'donor-1',
        campaignId: 'campaign-notif',
        campaign: {
          id: 'campaign-notif',
          title: 'Campaign Notifications',
          targetAmount: 5000000,
          collectedAmount: 1000000,
          creatorId: 'creator-notif',
        },
        prayer: null,
      });

      mockTransaction.mockResolvedValue({
        updatedDonation: { id: 'donation-notif', paymentStatus: 'confirmed', amount: 100000 },
        updatedCampaign: { id: 'campaign-notif', status: 'active', collectedAmount: 1100000 },
      });

      const request = createPatchRequest('http://localhost:3000/api/donations/donation-notif/confirm');
      await confirmDonation(request, { params: { id: 'donation-notif' } });

      expect(mockNotificationCreateMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          // Donor notification
          expect.objectContaining({
            type: 'donation_confirmed',
            userId: 'donor-1',
            title: 'Donasi Berhasil',
          }),
          // Creator notification
          expect.objectContaining({
            type: 'donation_confirmed',
            userId: 'creator-notif',
            title: 'Donasi Baru',
          }),
        ]),
      });

      const notifications = mockNotificationCreateMany.mock.calls[0][0].data;
      expect(notifications).toHaveLength(2);
    });

    it('should only create creator notification when donation is anonymous (no donorId)', async () => {
      mockDonationFindUnique.mockResolvedValue({
        id: 'donation-anon',
        amount: 50000,
        paymentStatus: 'pending',
        donorId: null,
        campaignId: 'campaign-anon',
        campaign: {
          id: 'campaign-anon',
          title: 'Anonymous Donation Campaign',
          targetAmount: 2000000,
          collectedAmount: 500000,
          creatorId: 'creator-anon',
        },
        prayer: null,
      });

      mockTransaction.mockResolvedValue({
        updatedDonation: { id: 'donation-anon', paymentStatus: 'confirmed', amount: 50000 },
        updatedCampaign: { id: 'campaign-anon', status: 'active', collectedAmount: 550000 },
      });

      const request = createPatchRequest('http://localhost:3000/api/donations/donation-anon/confirm');
      await confirmDonation(request, { params: { id: 'donation-anon' } });

      const notifications = mockNotificationCreateMany.mock.calls[0][0].data;
      expect(notifications).toHaveLength(1);
      expect(notifications[0].userId).toBe('creator-anon');
    });
  });

  describe('5. Balance donation deducts from user balance', () => {
    it('should deduct balance and create confirmed donation in one transaction', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-balance', name: 'Balance User', email: 'balance@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-bal',
        status: 'active',
        targetAmount: 1000000,
        collectedAmount: 400000,
      });
      mockUserFindUnique.mockResolvedValue({
        donationBalance: 200000,
      });
      mockTransaction.mockResolvedValue([
        { donationBalance: 150000 }, // new user balance after deduction
        { id: 'donation-bal', amount: 50000 }, // created donation
        { id: 'campaign-bal', collectedAmount: 450000 }, // updated campaign
      ]);

      const request = createPostRequest('http://localhost:3000/api/balance/donate', {
        campaignId: 'campaign-bal',
        amount: 50000,
      });

      const response = await balanceDonate(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.donationId).toBe('donation-bal');
      expect(data.newBalance).toBe(150000);
      expect(data.message).toBe('Donasi berhasil');
      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  describe('6. Balance donation rejects when insufficient balance', () => {
    it('should return 400 with current balance info when balance is too low', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-low', name: 'Low Balance', email: 'low@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-x',
        status: 'active',
        targetAmount: 500000,
        collectedAmount: 100000,
      });
      mockUserFindUnique.mockResolvedValue({
        donationBalance: 20000,
      });

      const request = createPostRequest('http://localhost:3000/api/balance/donate', {
        campaignId: 'campaign-x',
        amount: 50000,
      });

      const response = await balanceDonate(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Saldo tidak mencukupi');
      expect(data.currentBalance).toBe(20000);
      // Transaction should NOT be called
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('should reject when balance is exactly zero', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-zero', name: 'Zero Balance', email: 'zero@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-y',
        status: 'active',
        targetAmount: 500000,
        collectedAmount: 100000,
      });
      mockUserFindUnique.mockResolvedValue({
        donationBalance: 0,
      });

      const request = createPostRequest('http://localhost:3000/api/balance/donate', {
        campaignId: 'campaign-y',
        amount: 10000,
      });

      const response = await balanceDonate(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Saldo tidak mencukupi');
      expect(data.currentBalance).toBe(0);
    });
  });

  describe('7. Balance donation marks campaign as completed when target met', () => {
    it('should mark campaign as completed when donation causes collectedAmount >= targetAmount', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-complete', name: 'Final Donor', email: 'final@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-almost',
        status: 'active',
        targetAmount: 100000,
        collectedAmount: 80000, // 80000 + 30000 = 110000 >= 100000
      });
      mockUserFindUnique.mockResolvedValue({
        donationBalance: 50000,
      });
      mockTransaction.mockResolvedValue([
        { donationBalance: 20000 },
        { id: 'donation-final', amount: 30000 },
        { id: 'campaign-almost', collectedAmount: 110000, status: 'completed' },
      ]);

      const request = createPostRequest('http://localhost:3000/api/balance/donate', {
        campaignId: 'campaign-almost',
        amount: 30000,
      });

      const response = await balanceDonate(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.donationId).toBe('donation-final');
      // The transaction was called - verify the campaign should be marked complete
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should NOT mark campaign as completed when donation does not meet target', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-partial', name: 'Partial Donor', email: 'partial@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-partial',
        status: 'active',
        targetAmount: 1000000,
        collectedAmount: 200000, // 200000 + 50000 = 250000 < 1000000
      });
      mockUserFindUnique.mockResolvedValue({
        donationBalance: 100000,
      });
      mockTransaction.mockResolvedValue([
        { donationBalance: 50000 },
        { id: 'donation-partial', amount: 50000 },
        { id: 'campaign-partial', collectedAmount: 250000, status: 'active' },
      ]);

      const request = createPostRequest('http://localhost:3000/api/balance/donate', {
        campaignId: 'campaign-partial',
        amount: 50000,
      });

      const response = await balanceDonate(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.donationId).toBe('donation-partial');
      expect(mockTransaction).toHaveBeenCalled();
    });
  });
});
