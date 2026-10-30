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

vi.mock('@/lib/campaign-update-notify', () => ({
  notifyDonorsOfCampaignUpdate: vi.fn().mockResolvedValue({ recipients: 0, sent: 0 }),
}));

import { notifyDonorsOfCampaignUpdate } from '@/lib/campaign-update-notify';
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
    mockCampaignFind.mockResolvedValue({ id: 'campaign-1', creatorId: 'owner-1', lifecycleStatus: 'ACTIVE' } as any);
    mockUpdateCreate.mockResolvedValue({ id: 'update-1', ...validBody, images: [], createdAt: new Date() } as any);
  });

  it("lets the Campaign's Fundraiser post an update", async () => {
    signedInAs('owner-1');
    const response = await post();
    expect(response.status).toBe(201);
    expect(mockUpdateCreate).toHaveBeenCalledOnce();
    expect(notifyDonorsOfCampaignUpdate).toHaveBeenCalledWith(prisma, { updateId: 'update-1' });
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
    expect(notifyDonorsOfCampaignUpdate).not.toHaveBeenCalled();
  });

  it('accepts an image the upload route hosted (a relative /uploads path)', async () => {
    signedInAs('owner-1');
    const response = await post({ ...validBody, images: ['/uploads/abc-123.jpg'] });
    expect(response.status).toBe(201);
    expect(mockUpdateCreate.mock.calls[0][0].data.images).toEqual(['/uploads/abc-123.jpg']);
  });

  it('refuses an image that is neither http(s) nor an /uploads path', async () => {
    signedInAs('owner-1');
    const response = await post({ ...validBody, images: ['javascript:alert(1)'] });
    expect(response.status).toBe(400);
    expect(mockUpdateCreate).not.toHaveBeenCalled();
  });

  it.each(['..', '.', '...'])('refuses an /uploads name made only of dots (%s)', async (name) => {
    signedInAs('owner-1');
    const response = await post({ ...validBody, images: [`/uploads/${name}`] });
    expect(response.status).toBe(400);
  });

  it('refuses a third-party https image: the form only ever yields /uploads paths', async () => {
    signedInAs('owner-1');
    const response = await post({ ...validBody, images: ['https://tracker.example/p.gif'] });
    expect(response.status).toBe(400);
  });

  it('answers 404, like a missing slug, when a non-owner asks about an unapproved Campaign', async () => {
    signedInAs('someone-else');
    mockCampaignFind.mockResolvedValue({ id: 'campaign-1', creatorId: 'owner-1', lifecycleStatus: 'DRAFT' } as any);
    const response = await post();
    expect(response.status).toBe(404);
    expect(mockUpdateCreate).not.toHaveBeenCalled();
  });

  it('answers 404 for a slug that does not exist', async () => {
    signedInAs('owner-1');
    mockCampaignFind.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
  });

  it.each(['DRAFT', 'SUBMITTED', 'REJECTED'])(
    'tells the owner plainly that a %s Campaign takes no update yet, and writes nothing',
    async (status) => {
      signedInAs('owner-1');
      mockCampaignFind.mockResolvedValue({ id: 'campaign-1', creatorId: 'owner-1', lifecycleStatus: status } as any);
      const response = await post();
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('CAMPAIGN_NOT_PUBLIC');
      expect(mockUpdateCreate).not.toHaveBeenCalled();
    },
  );
});
