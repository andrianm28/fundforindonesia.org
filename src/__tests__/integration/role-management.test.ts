import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    notification: {
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
import { PATCH } from '@/app/api/admin/users/[id]/role/route';

const mockGetServerSession = getServerSession as unknown as Mock;
const mockUserUpdate = prisma.user.update as unknown as Mock;
const mockNotificationCreate = prisma.notification.create as unknown as Mock;

function createRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, options);
}

describe('Role Management Integration Tests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ─── Admin Changes User Role ──────────────────────────────────────────

  describe('Admin changes user role (Requirements 9.1, 9.2)', () => {
    it('should update user role when admin assigns a valid role', async () => {
      // First call from withRoleCheck, second call from inside the handler
      mockGetServerSession
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        })
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        });

      mockUserUpdate.mockResolvedValue({
        id: 'user-1',
        name: 'Target User',
        email: 'user@example.com',
        role: 'MODERATOR',
      });

      mockNotificationCreate.mockResolvedValue({
        id: 'notif-1',
        type: 'role_changed',
        title: 'Role Updated',
        message: 'Your role has been changed to MODERATOR',
        userId: 'user-1',
      });

      const req = createRequest('/api/admin/users/user-1/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'MODERATOR' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'user-1' }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.user.role).toBe('MODERATOR');

      // Verify prisma.user.update called with correct role
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { role: 'MODERATOR' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      });
    });

    it('should persist CAMPAIGN_CREATOR role correctly', async () => {
      mockGetServerSession
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        })
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        });

      mockUserUpdate.mockResolvedValue({
        id: 'user-2',
        name: 'Another User',
        email: 'another@example.com',
        role: 'CAMPAIGN_CREATOR',
      });

      mockNotificationCreate.mockResolvedValue({ id: 'notif-2' });

      const req = createRequest('/api/admin/users/user-2/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'CAMPAIGN_CREATOR' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'user-2' }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.user.role).toBe('CAMPAIGN_CREATOR');

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { role: 'CAMPAIGN_CREATOR' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      });
    });
  });

  // ─── Notification Created on Role Change ──────────────────────────────

  describe('Notification on role change (Requirement 9.4)', () => {
    it('should create a notification for the affected user when role changes', async () => {
      mockGetServerSession
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        })
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        });

      mockUserUpdate.mockResolvedValue({
        id: 'user-1',
        name: 'Target User',
        email: 'user@example.com',
        role: 'MODERATOR',
      });

      mockNotificationCreate.mockResolvedValue({
        id: 'notif-1',
        type: 'role_changed',
        title: 'Role Updated',
        message: 'Your role has been changed to MODERATOR',
        userId: 'user-1',
        link: '/akun',
      });

      const req = createRequest('/api/admin/users/user-1/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'MODERATOR' }),
      });

      await PATCH(req, { params: Promise.resolve({ id: 'user-1' }) });

      // Verify notification was created with correct data
      expect(mockNotificationCreate).toHaveBeenCalledWith({
        data: {
          type: 'role_changed',
          title: 'Role Updated',
          message: 'Your role has been changed to MODERATOR',
          userId: 'user-1',
          link: '/akun',
        },
      });
    });

    it('should create notification with correct role name for ADMIN upgrade', async () => {
      mockGetServerSession
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        })
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        });

      mockUserUpdate.mockResolvedValue({
        id: 'user-2',
        name: 'Promoted User',
        email: 'promoted@example.com',
        role: 'ADMIN',
      });

      mockNotificationCreate.mockResolvedValue({ id: 'notif-2' });

      const req = createRequest('/api/admin/users/user-2/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'ADMIN' }),
      });

      await PATCH(req, { params: Promise.resolve({ id: 'user-2' }) });

      expect(mockNotificationCreate).toHaveBeenCalledWith({
        data: {
          type: 'role_changed',
          title: 'Role Updated',
          message: 'Your role has been changed to ADMIN',
          userId: 'user-2',
          link: '/akun',
        },
      });
    });
  });

  // ─── Non-Admin Cannot Change Roles ────────────────────────────────────

  describe('Non-admin cannot change roles (Requirement 9.3)', () => {
    it('should return 403 when MODERATOR attempts role change', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'mod-1', email: 'mod@kitabisa.com', name: 'Moderator', role: 'MODERATOR' },
      });

      const req = createRequest('/api/admin/users/user-1/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'CAMPAIGN_CREATOR' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'user-1' }) });
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.error).toBe('Forbidden');

      // Verify no database operations were performed
      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockNotificationCreate).not.toHaveBeenCalled();
    });

    it('should return 403 when CAMPAIGN_CREATOR attempts role change', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'creator-1', email: 'creator@example.com', name: 'Creator', role: 'CAMPAIGN_CREATOR' },
      });

      const req = createRequest('/api/admin/users/user-1/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'MODERATOR' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'user-1' }) });
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.error).toBe('Forbidden');

      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockNotificationCreate).not.toHaveBeenCalled();
    });

    it('should return 403 when DONOR attempts role change', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'donor-1', email: 'donor@example.com', name: 'Donor', role: 'DONOR' },
      });

      const req = createRequest('/api/admin/users/user-1/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'ADMIN' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'user-1' }) });
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.error).toBe('Forbidden');

      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockNotificationCreate).not.toHaveBeenCalled();
    });
  });

  // ─── Invalid Role Value ───────────────────────────────────────────────

  describe('Invalid role value (Requirement 9.2)', () => {
    it('should return 400 for invalid role string', async () => {
      mockGetServerSession
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        })
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        });

      const req = createRequest('/api/admin/users/user-1/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'SUPERUSER' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'user-1' }) });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('Invalid role');

      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockNotificationCreate).not.toHaveBeenCalled();
    });

    it('should return 400 when role is missing from body', async () => {
      mockGetServerSession
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        })
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        });

      const req = createRequest('/api/admin/users/user-1/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'user-1' }) });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('Invalid role');

      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockNotificationCreate).not.toHaveBeenCalled();
    });

    it('should return 400 for empty string role', async () => {
      mockGetServerSession
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        })
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        });

      const req = createRequest('/api/admin/users/user-1/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: '' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'user-1' }) });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('Invalid role');

      expect(mockUserUpdate).not.toHaveBeenCalled();
    });
  });

  // ─── Self-Demotion Prevention ─────────────────────────────────────────

  describe('Self-demotion prevention (Requirement 9.5)', () => {
    it('should return 400 when admin tries to demote themselves', async () => {
      mockGetServerSession
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        })
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        });

      const req = createRequest('/api/admin/users/admin-1/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'MODERATOR' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'admin-1' }) });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('Cannot remove ADMIN role from yourself');

      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockNotificationCreate).not.toHaveBeenCalled();
    });

    it('should allow admin to keep their own ADMIN role', async () => {
      mockGetServerSession
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        })
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        });

      mockUserUpdate.mockResolvedValue({
        id: 'admin-1',
        name: 'Admin',
        email: 'admin@kitabisa.com',
        role: 'ADMIN',
      });

      mockNotificationCreate.mockResolvedValue({ id: 'notif-1' });

      const req = createRequest('/api/admin/users/admin-1/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'ADMIN' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'admin-1' }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.user.role).toBe('ADMIN');
    });

    it('should return 400 when admin tries to set own role to DONOR', async () => {
      mockGetServerSession
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        })
        .mockResolvedValueOnce({
          user: { id: 'admin-1', email: 'admin@kitabisa.com', name: 'Admin', role: 'ADMIN' },
        });

      const req = createRequest('/api/admin/users/admin-1/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'DONOR' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'admin-1' }) });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('Cannot remove ADMIN role from yourself');

      expect(mockUserUpdate).not.toHaveBeenCalled();
    });
  });

  // ─── Unauthenticated Access ───────────────────────────────────────────

  describe('Unauthenticated access', () => {
    it('should return 401 when no session exists', async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const req = createRequest('/api/admin/users/user-1/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'MODERATOR' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'user-1' }) });
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toBe('Unauthorized');

      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockNotificationCreate).not.toHaveBeenCalled();
    });
  });
});
