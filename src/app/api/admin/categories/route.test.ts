import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/** ADMIN-only Category list: 404 for anyone else (ticket 90), 400/409 on bad input. */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    category: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    campaign: { groupBy: vi.fn() },
  },
}));

import { GET, POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const mockFindMany = prisma.category.findMany as unknown as Mock;
const mockFindFirst = prisma.category.findFirst as unknown as Mock;
const mockCreate = prisma.category.create as unknown as Mock;
const mockGroupBy = prisma.campaign.groupBy as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/categories';

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
}
const get = () => GET(new NextRequest(URL));

const valid = { name: 'Masjid', slug: 'masjid', icon: '🕌', order: 8 };

describe('/api/admin/categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockImplementation(async ({ data }) => ({ id: 'c1', ...data }));
  });

  it('answers 404 to someone who is not an Admin, on both methods, and touches nothing', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u-1', assignments: ['VERIFIER'] } });

    expect((await get()).status).toBe(404);
    expect((await post(valid)).status).toBe(404);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('answers 401 to a visitor who is not signed in', async () => {
    mockSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  it('lists categories with how many Campaigns use each', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'c1', name: 'Masjid', slug: 'masjid', icon: '🕌', order: 1 },
      { id: 'c2', name: 'Sekolah', slug: 'sekolah', icon: '🏫', order: 2 },
    ]);
    mockGroupBy.mockResolvedValue([{ category: 'masjid', _count: { _all: 3 } }]);

    const res = await get();

    expect(res.status).toBe(200);
    const { categories } = await res.json();
    expect(categories.map((c: { slug: string; campaignCount: number }) => [c.slug, c.campaignCount])).toEqual([
      ['masjid', 3],
      ['sekolah', 0],
    ]);
  });

  it('creates a category with 201', async () => {
    const res = await post(valid);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith({ data: valid });
  });

  it.each([
    ['an uppercase slug', { ...valid, slug: 'Masjid' }],
    ['a slug with a space', { ...valid, slug: 'rumah ibadah' }],
    ['a blank name', { ...valid, name: ' ' }],
    ['a missing icon', { name: 'Masjid', slug: 'masjid' }],
    ['a body that is not an object', [1]],
  ])('answers 400 for %s', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe('string');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('answers 409 for a slug that is taken', async () => {
    mockFindFirst.mockResolvedValue({ slug: 'masjid' });
    const res = await post(valid);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('Slug');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('answers 409 for a name that is taken under another slug', async () => {
    mockFindFirst.mockResolvedValue({ slug: 'lain' });
    const res = await post(valid);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('Nama');
  });
});
