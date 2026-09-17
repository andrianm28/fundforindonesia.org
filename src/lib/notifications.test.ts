import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  notifyDonationConfirmed,
  notifyCampaignUpdate,
  notifyDisbursement,
} from './notifications';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    notification: {
      createMany: vi.fn(),
    },
    donation: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';

const mockNotificationCreateMany = prisma.notification.createMany as unknown as Mock;
const mockDonationFindMany = prisma.donation.findMany as unknown as Mock;

describe('notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotificationCreateMany.mockResolvedValue({ count: 0 });
  });

  describe('notifyDonationConfirmed', () => {
    it('should create notifications for both donor and creator', async () => {
      await notifyDonationConfirmed({
        donorId: 'donor-1',
        creatorId: 'creator-1',
        campaignId: 'campaign-1',
        campaignTitle: 'Test Campaign',
        amount: 50000,
      });

      expect(mockNotificationCreateMany).toHaveBeenCalledWith({
        data: [
          {
            type: 'donation_confirmed',
            title: 'Donasi Berhasil',
            message: 'Donasi Anda sebesar Rp50.000 telah berhasil dikonfirmasi',
            userId: 'donor-1',
            link: '/campaign/campaign-1',
          },
          {
            type: 'donation_confirmed',
            title: 'Donasi Baru',
            message: 'Donasi baru sebesar Rp50.000 untuk campaign "Test Campaign"',
            userId: 'creator-1',
            link: '/campaign/campaign-1',
          },
        ],
      });
    });

    it('should only notify creator when donorId is null (anonymous donation)', async () => {
      await notifyDonationConfirmed({
        donorId: null,
        creatorId: 'creator-1',
        campaignId: 'campaign-1',
        campaignTitle: 'Test Campaign',
        amount: 100000,
      });

      expect(mockNotificationCreateMany).toHaveBeenCalledWith({
        data: [
          {
            type: 'donation_confirmed',
            title: 'Donasi Baru',
            message: 'Donasi baru sebesar Rp100.000 untuk campaign "Test Campaign"',
            userId: 'creator-1',
            link: '/campaign/campaign-1',
          },
        ],
      });
    });

    it('should format large amounts correctly', async () => {
      await notifyDonationConfirmed({
        donorId: 'donor-1',
        creatorId: 'creator-1',
        campaignId: 'campaign-1',
        campaignTitle: 'Big Campaign',
        amount: 25000000,
      });

      const callData = mockNotificationCreateMany.mock.calls[0][0].data;
      expect(callData[0].message).toContain('Rp25.000.000');
      expect(callData[1].message).toContain('Rp25.000.000');
    });
  });

  describe('notifyCampaignUpdate', () => {
    it('should notify all unique donors of the campaign', async () => {
      mockDonationFindMany.mockResolvedValue([
        { donorId: 'donor-1' },
        { donorId: 'donor-2' },
        { donorId: 'donor-3' },
      ]);

      await notifyCampaignUpdate({
        campaignId: 'campaign-1',
        campaignTitle: 'Test Campaign',
        updateTitle: 'Progress Update',
      });

      expect(mockDonationFindMany).toHaveBeenCalledWith({
        where: { campaignId: 'campaign-1', paymentStatus: 'confirmed', donorId: { not: null } },
        select: { donorId: true },
        distinct: ['donorId'],
      });

      expect(mockNotificationCreateMany).toHaveBeenCalledWith({
        data: [
          {
            type: 'campaign_update',
            title: 'Kabar Terbaru',
            message: 'Test Campaign: Progress Update',
            userId: 'donor-1',
            link: '/campaign/campaign-1',
          },
          {
            type: 'campaign_update',
            title: 'Kabar Terbaru',
            message: 'Test Campaign: Progress Update',
            userId: 'donor-2',
            link: '/campaign/campaign-1',
          },
          {
            type: 'campaign_update',
            title: 'Kabar Terbaru',
            message: 'Test Campaign: Progress Update',
            userId: 'donor-3',
            link: '/campaign/campaign-1',
          },
        ],
      });
    });

    it('should not create notifications when there are no donors', async () => {
      mockDonationFindMany.mockResolvedValue([]);

      await notifyCampaignUpdate({
        campaignId: 'campaign-1',
        campaignTitle: 'Test Campaign',
        updateTitle: 'Progress Update',
      });

      expect(mockNotificationCreateMany).not.toHaveBeenCalled();
    });

    it('should filter out null donorIds', async () => {
      mockDonationFindMany.mockResolvedValue([
        { donorId: 'donor-1' },
        { donorId: null },
        { donorId: 'donor-2' },
      ]);

      await notifyCampaignUpdate({
        campaignId: 'campaign-1',
        campaignTitle: 'Test Campaign',
        updateTitle: 'Update',
      });

      const callData = mockNotificationCreateMany.mock.calls[0][0].data;
      expect(callData).toHaveLength(2);
      expect(callData[0].userId).toBe('donor-1');
      expect(callData[1].userId).toBe('donor-2');
    });
  });

  describe('notifyDisbursement', () => {
    it('should notify all unique donors of the campaign', async () => {
      mockDonationFindMany.mockResolvedValue([
        { donorId: 'donor-1' },
        { donorId: 'donor-2' },
      ]);

      await notifyDisbursement({
        campaignId: 'campaign-1',
        campaignTitle: 'Test Campaign',
        amount: 5000000,
      });

      expect(mockDonationFindMany).toHaveBeenCalledWith({
        where: { campaignId: 'campaign-1', paymentStatus: 'confirmed', donorId: { not: null } },
        select: { donorId: true },
        distinct: ['donorId'],
      });

      expect(mockNotificationCreateMany).toHaveBeenCalledWith({
        data: [
          {
            type: 'disbursement',
            title: 'Pencairan Dana',
            message: 'Pencairan dana sebesar Rp5.000.000 dari campaign "Test Campaign"',
            userId: 'donor-1',
            link: '/campaign/campaign-1',
          },
          {
            type: 'disbursement',
            title: 'Pencairan Dana',
            message: 'Pencairan dana sebesar Rp5.000.000 dari campaign "Test Campaign"',
            userId: 'donor-2',
            link: '/campaign/campaign-1',
          },
        ],
      });
    });

    it('should not create notifications when there are no donors', async () => {
      mockDonationFindMany.mockResolvedValue([]);

      await notifyDisbursement({
        campaignId: 'campaign-1',
        campaignTitle: 'Test Campaign',
        amount: 1000000,
      });

      expect(mockNotificationCreateMany).not.toHaveBeenCalled();
    });

    it('should filter out null donorIds', async () => {
      mockDonationFindMany.mockResolvedValue([
        { donorId: null },
        { donorId: 'donor-1' },
      ]);

      await notifyDisbursement({
        campaignId: 'campaign-1',
        campaignTitle: 'Test Campaign',
        amount: 500000,
      });

      const callData = mockNotificationCreateMany.mock.calls[0][0].data;
      expect(callData).toHaveLength(1);
      expect(callData[0].userId).toBe('donor-1');
    });
  });
});
