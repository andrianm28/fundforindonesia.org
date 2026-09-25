import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
  },
}));

import { POST } from './route';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const mockGetServerSession = vi.mocked(getServerSession);
const mockUserUpdate = vi.mocked(prisma.user.update);

describe('POST /api/user/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
  });

  it('never grants the verified flag or the Fundraiser role', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'donor-user', role: 'DONOR', name: 'Budi', email: 'budi@test.com', isVerified: false, verificationType: null },
      expires: '2099-01-01',
    } as any);

    const response = await POST();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/Admin/);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
