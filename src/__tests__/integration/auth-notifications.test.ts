import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    donation: {
      findMany: vi.fn(),
    },
  },
}));

// Mock the hashing wrapper (real cost/compat is covered in password-hash.test.ts)
vi.mock('@/lib/password-hash', () => ({
  hashPassword: vi.fn().mockResolvedValue('$2a$12$hashed_password_value'),
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/password-hash';
import { PASSWORD_HASH_COST } from '@/lib/password-hash-cost';
import { sealUserEmail } from '@/lib/contact-fields';
import { getServerSession } from '@/lib/auth';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { GET as notificationsGET } from '@/app/api/notifications/route';
import { PATCH as notificationsReadPATCH } from '@/app/api/notifications/read/route';
import { GET as unreadCountGET } from '@/app/api/notifications/unread-count/route';
import {
  notifyDonationConfirmed,
  notifyCampaignUpdate,
  notifyPayout,
} from '@/lib/notifications';

const mockGetServerSession = getServerSession as unknown as Mock;
const mockUserFindFirst = prisma.user.findFirst as unknown as Mock;
const mockUserCreate = prisma.user.create as unknown as Mock;
const mockNotificationFindMany = prisma.notification.findMany as unknown as Mock;
const mockNotificationCount = prisma.notification.count as unknown as Mock;
const mockNotificationUpdateMany = prisma.notification.updateMany as unknown as Mock;
const mockNotificationCreateMany = prisma.notification.createMany as unknown as Mock;
const mockDonationFindMany = prisma.donation.findMany as unknown as Mock;
const mockBcryptHash = hashPassword as unknown as Mock;

function createRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, options);
}

describe('Auth & Notifications Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotificationCreateMany.mockResolvedValue({ count: 0 });
  });

  // ─── Registration Tests ───────────────────────────────────────────────

  describe('Registration: POST /api/auth/register', () => {
    it('should create user with hashed password on successful registration', async () => {
      mockUserFindFirst.mockResolvedValue(null);
      mockUserCreate.mockResolvedValue({
        id: 'user-1',
        name: 'John Doe',
        ...sealUserEmail('john@example.com'),
      });

      const req = createRequest('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'securepass123',
        }),
      });

      const res = await registerPOST(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.message).toBe('Registrasi berhasil');
      expect(body.user.email).toBe('john@example.com');
      expect(body.user.name).toBe('John Doe');

      // Verify bcrypt was used to hash the password
      expect(mockBcryptHash).toHaveBeenCalledWith('securepass123', PASSWORD_HASH_COST);

      // Verify user was created with hashed password (not plain text), and
      // with the address sealed rather than in the clear (ADR 0012).
      const { data } = mockUserCreate.mock.calls[0]![0]!;
      expect(data).toMatchObject({
        name: 'John Doe',
        password: '$2a$12$hashed_password_value',
      });
      expect(data).not.toHaveProperty('email');
      expect(data.emailHmac).toBeDefined();
    });

    it('should return 409 for duplicate email', async () => {
      mockUserFindFirst.mockResolvedValue({ id: 'existing-user' } as never);

      const req = createRequest('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Another User',
          email: 'existing@example.com',
          password: 'password123',
        }),
      });

      const res = await registerPOST(req);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.message).toBe('Email sudah terdaftar');
      // Should NOT have attempted to create the user
      expect(mockUserCreate).not.toHaveBeenCalled();
    });

    it('should return 400 with field errors for missing required fields', async () => {
      // Missing all fields
      const req1 = createRequest('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res1 = await registerPOST(req1);
      const body1 = await res1.json();

      expect(res1.status).toBe(400);
      expect(body1.message).toBe('Validasi gagal');
      expect(body1.errors).toBeDefined();
      expect(body1.errors.name).toBeDefined();
      expect(body1.errors.email).toBeDefined();
      expect(body1.errors.password).toBeDefined();

      // Missing name only
      const req2 = createRequest('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', password: '12345678' }),
      });

      const res2 = await registerPOST(req2);
      const body2 = await res2.json();

      expect(res2.status).toBe(400);
      expect(body2.errors.name).toBeDefined();

      // Invalid email format
      const req3 = createRequest('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', email: 'not-an-email', password: '12345678' }),
      });

      const res3 = await registerPOST(req3);
      const body3 = await res3.json();

      expect(res3.status).toBe(400);
      expect(body3.errors.email).toBe('Format email tidak valid');

      // Password too short
      const req4 = createRequest('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', email: 'test@example.com', password: '123' }),
      });

      const res4 = await registerPOST(req4);
      const body4 = await res4.json();

      expect(res4.status).toBe(400);
      expect(body4.errors.password).toBe('Password minimal 8 karakter');
    });
  });

  // ─── Notifications GET Tests ──────────────────────────────────────────

  describe('Notifications: GET /api/notifications', () => {
    it('should return user notifications paginated', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', email: 'test@example.com', name: 'Test' },
      });

      const mockNotifications = [
        {
          id: 'notif-1',
          type: 'donation_confirmed',
          title: 'Donasi Berhasil',
          message: 'Donasi Anda berhasil',
          isRead: false,
          link: '/campaign/test',
          createdAt: new Date('2024-01-02'),
        },
        {
          id: 'notif-2',
          type: 'campaign_update',
          title: 'Kabar Terbaru',
          message: 'Update campaign',
          isRead: true,
          link: '/campaign/test',
          createdAt: new Date('2024-01-01'),
        },
      ];

      mockNotificationFindMany.mockResolvedValue(mockNotifications);
      mockNotificationCount.mockResolvedValue(5);

      const req = createRequest('/api/notifications?page=1&limit=2');
      const res = await notificationsGET(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.notifications).toHaveLength(2);
      expect(body.total).toBe(5);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(2);
      expect(body.totalPages).toBe(3);

      // Verify Prisma called with correct userId and pagination
      expect(mockNotificationFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 2,
        })
      );
    });

    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const req = createRequest('/api/notifications');
      const res = await notificationsGET(req);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });
  });

  // ─── Notifications Read Tests ─────────────────────────────────────────

  describe('Notifications: PATCH /api/notifications/read', () => {
    it('should mark specific notifications as read', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', email: 'test@example.com', name: 'Test' },
      });
      mockNotificationUpdateMany.mockResolvedValue({ count: 2 });

      const req = createRequest('/api/notifications/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: ['notif-1', 'notif-2'] }),
      });

      const res = await notificationsReadPATCH(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.updatedCount).toBe(2);

      // Verify the Prisma call filters by specific IDs
      expect(mockNotificationUpdateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          isRead: false,
          id: { in: ['notif-1', 'notif-2'] },
        },
        data: { isRead: true },
      });
    });

    it('should mark all as read when no IDs provided', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', email: 'test@example.com', name: 'Test' },
      });
      mockNotificationUpdateMany.mockResolvedValue({ count: 5 });

      const req = createRequest('/api/notifications/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await notificationsReadPATCH(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.updatedCount).toBe(5);

      // Should NOT have the id filter when no IDs provided
      expect(mockNotificationUpdateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          isRead: false,
        },
        data: { isRead: true },
      });
    });

    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const req = createRequest('/api/notifications/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await notificationsReadPATCH(req);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });
  });

  // ─── Unread Count Tests ───────────────────────────────────────────────

  describe('Notifications: GET /api/notifications/unread-count', () => {
    it('should return correct unread count', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', email: 'test@example.com', name: 'Test' },
      });
      mockNotificationCount.mockResolvedValue(3);

      const res = await unreadCountGET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.count).toBe(3);

      // Verify it counts only unread notifications for the user
      expect(mockNotificationCount).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          isRead: false,
        },
      });
    });

    it('should return 0 when no unread notifications', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', email: 'test@example.com', name: 'Test' },
      });
      mockNotificationCount.mockResolvedValue(0);

      const res = await unreadCountGET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.count).toBe(0);
    });

    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const res = await unreadCountGET();
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });
  });

  // ─── Notification Generation Tests ────────────────────────────────────

  describe('Notification Generation Utilities', () => {
    it('should create correct notifications for donation confirmation', async () => {
      await notifyDonationConfirmed({
        donorId: 'donor-1',
        creatorId: 'creator-1',
        campaignId: 'campaign-1',
        campaignTitle: 'Bantu Anak Yatim',
        amount: 100000,
      });

      expect(mockNotificationCreateMany).toHaveBeenCalledWith({
        data: [
          {
            type: 'donation_confirmed',
            title: 'Donasi Berhasil',
            message: 'Donasi Anda sebesar Rp100.000 telah berhasil dikonfirmasi',
            userId: 'donor-1',
            link: '/campaign/campaign-1',
          },
          {
            type: 'donation_confirmed',
            title: 'Donasi Baru',
            message: 'Donasi baru sebesar Rp100.000 untuk campaign "Bantu Anak Yatim"',
            userId: 'creator-1',
            link: '/campaign/campaign-1',
          },
        ],
      });
    });

    it('should create notifications for campaign updates to all donors', async () => {
      mockDonationFindMany.mockResolvedValue([
        { donorId: 'donor-1' },
        { donorId: 'donor-2' },
      ]);

      await notifyCampaignUpdate({
        campaignId: 'campaign-1',
        campaignTitle: 'Bantu Anak Yatim',
        updateTitle: 'Dana telah disalurkan',
      });

      expect(mockNotificationCreateMany).toHaveBeenCalledWith({
        data: [
          {
            type: 'campaign_update',
            title: 'Kabar Terbaru',
            message: 'Bantu Anak Yatim: Dana telah disalurkan',
            userId: 'donor-1',
            link: '/campaign/campaign-1',
          },
          {
            type: 'campaign_update',
            title: 'Kabar Terbaru',
            message: 'Bantu Anak Yatim: Dana telah disalurkan',
            userId: 'donor-2',
            link: '/campaign/campaign-1',
          },
        ],
      });
    });

    it('should create notifications for disbursements to all donors', async () => {
      mockDonationFindMany.mockResolvedValue([
        { donorId: 'donor-1' },
        { donorId: 'donor-2' },
        { donorId: 'donor-3' },
      ]);

      await notifyPayout({
        campaignId: 'campaign-1',
        campaignTitle: 'Bantu Anak Yatim',
        amount: 10000000,
      });

      expect(mockNotificationCreateMany).toHaveBeenCalledWith({
        data: [
          {
            type: 'disbursement',
            title: 'Pencairan Dana',
            message: 'Pencairan dana sebesar Rp10.000.000 dari campaign "Bantu Anak Yatim"',
            userId: 'donor-1',
            link: '/campaign/campaign-1',
          },
          {
            type: 'disbursement',
            title: 'Pencairan Dana',
            message: 'Pencairan dana sebesar Rp10.000.000 dari campaign "Bantu Anak Yatim"',
            userId: 'donor-2',
            link: '/campaign/campaign-1',
          },
          {
            type: 'disbursement',
            title: 'Pencairan Dana',
            message: 'Pencairan dana sebesar Rp10.000.000 dari campaign "Bantu Anak Yatim"',
            userId: 'donor-3',
            link: '/campaign/campaign-1',
          },
        ],
      });
    });

    it('should skip donor notification for anonymous donations (null donorId)', async () => {
      await notifyDonationConfirmed({
        donorId: null,
        creatorId: 'creator-1',
        campaignId: 'campaign-1',
        campaignTitle: 'Bantu Anak Yatim',
        amount: 50000,
      });

      // Should only have the creator notification
      expect(mockNotificationCreateMany).toHaveBeenCalledWith({
        data: [
          {
            type: 'donation_confirmed',
            title: 'Donasi Baru',
            message: 'Donasi baru sebesar Rp50.000 untuk campaign "Bantu Anak Yatim"',
            userId: 'creator-1',
            link: '/campaign/campaign-1',
          },
        ],
      });
    });
  });
});
