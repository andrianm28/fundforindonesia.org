import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    campaignUpdate: { create: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockCampaignFind = vi.mocked(prisma.campaign.findUnique);
const mockUpdateCreate = vi.mocked(prisma.campaignUpdate.create);
const mockSession = vi.mocked(getServerSession);

const validBody = { title: 'Kabar terbaru', content: 'Dana sudah disalurkan ke lokasi.' };

function post(body: unknown = validBody) {
  const request = new NextRequest('http://localhost:3000/api/campaigns/my-campaign/updates', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return POST(request, { params: Promise.resolve({ slug: 'my-campaign' }) });
}

function signedInAs(id: string) {
  mockSession.mockResolvedValue({ user: { id, assignments: [] }, expires: '2099-01-01' } as any);
}

describe('POST /api/campaigns/[slug]/updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCampaignFind.mockResolvedValue({ id: 'campaign-1', creatorId: 'owner-1' } as any);
    mockUpdateCreate.mockResolvedValue({ id: 'update-1', ...validBody, images: [], createdAt: new Date() } as any);
  });

  it("lets the Campaign's Fundraiser post an update", async () => {
    signedInAs('owner-1');
    const response = await post();
    expect(response.status).toBe(201);
    expect(mockUpdateCreate).toHaveBeenCalledOnce();
  });

  it('refuses anyone else with 403 NOT_AUTHORIZED and writes nothing', async () => {
    signedInAs('someone-else');
    const response = await post();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Hanya Fundraiser Campaign ini yang dapat melakukan tindakan ini.',
      code: 'NOT_AUTHORIZED',
    });
    expect(mockUpdateCreate).not.toHaveBeenCalled();
  });
});
