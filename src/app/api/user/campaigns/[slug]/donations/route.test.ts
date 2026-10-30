import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    donation: { findMany: vi.fn(), count: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));

import { GET } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const campaignFind = prisma.campaign.findUnique as unknown as Mock;
const donationFind = prisma.donation.findMany as unknown as Mock;
const donationCount = prisma.donation.count as unknown as Mock;
const session = getServerSession as unknown as Mock;

const ctx = { params: Promise.resolve({ slug: 'banjir' }) };
const req = (qs = '') => new NextRequest(`http://localhost:3000/api/user/campaigns/banjir/donations${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: 'owner-1' } });
  campaignFind.mockResolvedValue({ id: 'c1', creatorId: 'owner-1' });
  donationCount.mockResolvedValue(0);
  donationFind.mockResolvedValue([]);
});

describe('GET /api/user/campaigns/[slug]/donations', () => {
  it('401 tanpa sesi', async () => {
    session.mockResolvedValue(null);
    expect((await GET(req(), ctx)).status).toBe(401);
  });

  it('404 untuk non-pemilik, sama dengan slug yang tidak ada', async () => {
    session.mockResolvedValue({ user: { id: 'orang-lain' } });
    const res = await GET(req(), ctx);
    expect(res.status).toBe(404);
    expect(donationFind).not.toHaveBeenCalled();

    campaignFind.mockResolvedValue(null);
    expect((await GET(req(), ctx)).status).toBe(404);
  });

  it('pemilik melihat donasi; anonim jadi Anonim; tanpa email, kontak, atau token', async () => {
    donationCount.mockResolvedValue(2);
    donationFind.mockResolvedValue([
      { id: 'd1', amount: 50_000, isAnonymous: true, createdAt: new Date('2026-10-01T00:00:00Z'), donor: { name: 'Budi' }, guestName: null },
      { id: 'd2', amount: 25_000, isAnonymous: false, createdAt: new Date('2026-10-02T00:00:00Z'), donor: null, guestName: 'Tamu' },
    ]);
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.donations.map((d: { donorName: string }) => d.donorName)).toEqual(['Anonim', 'Tamu']);
    expect(Object.keys(data.donations[0]).sort()).toEqual(['amount', 'createdAt', 'donorName', 'id']);
    expect(JSON.stringify(data)).not.toMatch(/Budi|email|phone|token/i);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(data).toMatchObject({ total: 2, page: 1, limit: 10, totalPages: 1 });
  });

  it('hanya donasi confirmed, non-sandbox, dan tidak memilih kolom kontak', async () => {
    await GET(req('?page=3&limit=5'), ctx);
    const args = donationFind.mock.calls[0][0];
    expect(args.where).toEqual({
      campaignId: 'c1',
      paymentStatus: 'confirmed',
      payments: { none: { sandbox: true } },
    });
    expect(args.skip).toBe(10);
    expect(args.take).toBe(5);
    expect(Object.keys(args.select).sort()).toEqual(['amount', 'createdAt', 'donor', 'guestName', 'id', 'isAnonymous']);
  });
});
