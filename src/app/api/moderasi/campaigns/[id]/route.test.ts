import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/withRoleCheck', () => ({
  withRoleCheck: (_role: string, handler: unknown) => handler,
}));

import { PATCH } from './route';
import { prisma } from '@/lib/prisma';

const mockFindUnique = vi.mocked(prisma.campaign.findUnique);
const mockUpdate = vi.mocked(prisma.campaign.update);

function patchRequest(action: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/moderasi/campaigns/campaign-1', {
    method: 'PATCH',
    body: JSON.stringify({ action }),
    headers: { 'Content-Type': 'application/json' },
  });
}

function patchContext() {
  return { params: Promise.resolve({ id: 'campaign-1' }) };
}

describe('PATCH /api/moderasi/campaigns/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'creator-1',
      title: 'Bantu Korban Banjir',
    } as never);
    mockUpdate.mockImplementation(async (args: unknown) => ({
      id: 'campaign-1',
      slug: 'bantu-korban-banjir',
      ...(args as { data: Record<string, unknown> }).data,
    }) as never);
  });

  it('approve sets status active and lifecycleStatus ACTIVE', async () => {
    const response = await PATCH(patchRequest('approve'), patchContext());

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'campaign-1' },
        data: expect.objectContaining({
          status: 'active',
          lifecycleStatus: 'ACTIVE',
        }),
      })
    );
  });

  it('reject sets status rejected and lifecycleStatus REJECTED', async () => {
    const response = await PATCH(patchRequest('reject'), patchContext());

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'rejected',
          lifecycleStatus: 'REJECTED',
        }),
      })
    );
  });

  it('suspend sets status suspended and lifecycleStatus SUSPENDED', async () => {
    const response = await PATCH(patchRequest('suspend'), patchContext());

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'suspended',
          lifecycleStatus: 'SUSPENDED',
        }),
      })
    );
  });
});
