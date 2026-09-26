import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getUpdates } from './updates/route';
import { GET as getDonations } from './donations/route';
import { GET as getDisbursements } from './disbursements/route';

// CONTEXT.md, Campaign Status: a Draft, Submitted or Rejected Campaign opens
// only for its Fundraiser, Verifiers and Admins. Its public sub-resources
// answer exactly as GET /api/campaigns/[slug] does: to anyone else it does
// not exist.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    campaignUpdate: { findMany: vi.fn(), count: vi.fn() },
    donation: { findMany: vi.fn(), count: vi.fn() },
    payout: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockCampaignFind = vi.mocked(prisma.campaign.findUnique);
const mockSession = vi.mocked(getServerSession);

type Handler = (
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) => Promise<Response>;

const subResources: Array<[string, Handler, (body: any) => unknown]> = [
  ['updates', getUpdates as Handler, (body) => body.updates],
  ['donations', getDonations as Handler, (body) => body.donations],
  ['disbursements', getDisbursements as Handler, (body) => body.disbursements],
];

const viewers = {
  anonymous: null,
  'another signed-in user': { user: { id: 'donor-9', assignments: [] } },
  'the Fundraiser': { user: { id: 'owner-1', assignments: [] } },
  'a Verifier': { user: { id: 'verifier-1', assignments: ['VERIFIER'] } },
  'an Admin': { user: { id: 'admin-1', assignments: ['ADMIN'] } },
} as const;

const privileged = ['the Fundraiser', 'a Verifier', 'an Admin'] as const;
const outsiders = ['anonymous', 'another signed-in user'] as const;

function row(lifecycleStatus: string, deadline: Date | null = null) {
  return { id: 'campaign-1', creatorId: 'owner-1', lifecycleStatus, deadline };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.campaignUpdate.findMany).mockResolvedValue([
    { id: 'u1', title: 'Kabar', content: 'Isi rahasia', images: [], createdAt: new Date() },
  ] as any);
  vi.mocked(prisma.campaignUpdate.count).mockResolvedValue(1);
  vi.mocked(prisma.donation.findMany).mockResolvedValue([
    { id: 'd1', amount: 50_000, isAnonymous: false, message: null, createdAt: new Date(), donor: { name: 'Budi' } },
  ] as any);
  vi.mocked(prisma.donation.count).mockResolvedValue(1);
  vi.mocked(prisma.payout.findMany).mockResolvedValue([
    { id: 'p1', amount: 10_000, description: 'Semen', proofImage: null, createdAt: new Date() },
  ] as any);
});

describe.each(subResources)('GET /api/campaigns/[slug]/%s', (_name, handler, items) => {
  async function getAs(viewer: keyof typeof viewers, campaign: ReturnType<typeof row> | null) {
    mockSession.mockResolvedValue(viewers[viewer] as any);
    mockCampaignFind.mockResolvedValue(campaign as any);
    const response = await handler(
      new NextRequest(`http://localhost:3000/api/campaigns/sumur-desa/${_name}`),
      { params: Promise.resolve({ slug: 'sumur-desa' }) }
    );
    return { response, body: await response.json() };
  }

  it('answers a missing slug with 404, never shared-cached', async () => {
    const { response, body } = await getAs('anonymous', null);
    expect(response.status).toBe(404);
    expect(body).toEqual({ code: 'NOT_FOUND', message: 'Campaign tidak ditemukan', status: 404 });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  describe.each(['DRAFT', 'SUBMITTED', 'REJECTED'])('while %s', (status) => {
    it.each(outsiders)('answers 404 to %s, exactly as for a missing slug', async (viewer) => {
      const { response, body } = await getAs(viewer, row(status));
      expect(response.status).toBe(404);
      expect(body).toEqual({ code: 'NOT_FOUND', message: 'Campaign tidak ditemukan', status: 404 });
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    });

    it.each(privileged)('opens for %s, never shared-cached', async (viewer) => {
      const { response, body } = await getAs(viewer, row(status));
      expect(response.status).toBe(200);
      expect(items(body)).toHaveLength(1);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    });
  });

  describe.each(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'COMPLETED'])('once approved (%s)', (status) => {
    it.each(outsiders)('opens for %s as today, without reading the session', async (viewer) => {
      const { response, body } = await getAs(viewer, row(status));
      expect(response.status).toBe(200);
      expect(items(body)).toHaveLength(1);
      expect(response.headers.get('Cache-Control')).not.toBe('private, no-store');
      expect(mockSession).not.toHaveBeenCalled();
    });
  });

  it('opens an Active Campaign past its deadline (Expired) for anyone', async () => {
    const { response } = await getAs('anonymous', row('ACTIVE', new Date('2020-01-01')));
    expect(response.status).toBe(200);
    expect(mockSession).not.toHaveBeenCalled();
  });

  it('answers 404 to an outsider for a status it does not know (deny by default)', async () => {
    const { response } = await getAs('anonymous', row('SOMETHING_NEW'));
    expect(response.status).toBe(404);
  });
});
