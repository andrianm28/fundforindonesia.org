import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Admin curation of the home page (PKS pemenuhan 15): ADMIN only, and anyone
 * else gets the 404 of a route that does not exist (ticket 90).
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ tx: true })) },
}));
vi.mock('@/lib/home-curation', () => ({
  setCampaignFeatures: vi.fn(),
  setPrayerHighlights: vi.fn(),
  listCuration: vi.fn(),
}));

import { GET, PUT } from './route';
import { getServerSession } from '@/lib/auth';
import { listCuration, setCampaignFeatures, setPrayerHighlights } from '@/lib/home-curation';

const mockSession = getServerSession as unknown as Mock;
const mockSetCampaigns = setCampaignFeatures as unknown as Mock;
const mockSetPrayers = setPrayerHighlights as unknown as Mock;
const mockList = listCuration as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/kurasi';

const put = (body: unknown) => PUT(new NextRequest(URL, { method: 'PUT', body: JSON.stringify(body) }));
const get = () => GET(new NextRequest(URL));

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
  mockSetCampaigns.mockResolvedValue('OK');
  mockSetPrayers.mockResolvedValue('OK');
  mockList.mockResolvedValue({ pilihan: [], unggulan: [], sorotan: [] });
});

describe('/api/admin/kurasi', () => {
  it('answers 404 to someone who is not an Admin, on both methods, and writes nothing', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u-1', assignments: ['VERIFIER'] } });

    expect((await get()).status).toBe(404);
    expect((await put({ slot: 'PILIHAN', ids: ['a'] })).status).toBe(404);
    expect(mockSetCampaigns).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('answers 401 to a visitor who is not signed in', async () => {
    mockSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect((await put({ slot: 'PILIHAN', ids: [] })).status).toBe(401);
  });

  it('GET lists the current marks', async () => {
    mockList.mockResolvedValue({ pilihan: [{ id: 'c1' }], unggulan: [], sorotan: [] });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pilihan: [{ id: 'c1' }], unggulan: [], sorotan: [] });
  });

  it.each([
    ['PILIHAN', 'PILIHAN'],
    ['UNGGULAN_KATEGORI', 'UNGGULAN_KATEGORI'],
  ])('PUT %s sets that Campaign slot, recorded as the Admin who sent it', async (slot, kind) => {
    const res = await put({ slot, ids: ['b', 'a'] });

    expect(res.status).toBe(200);
    expect(mockSetCampaigns).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind, campaignIds: ['b', 'a'], actorId: 'admin-1', now: expect.any(Date) }),
    );
    expect(mockSetPrayers).not.toHaveBeenCalled();
  });

  it('PUT SOROTAN_DOA sets the Prayer highlights', async () => {
    const res = await put({ slot: 'SOROTAN_DOA', ids: ['p1'] });

    expect(res.status).toBe(200);
    expect(mockSetPrayers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ prayerIds: ['p1'], actorId: 'admin-1' }),
    );
    expect(mockSetCampaigns).not.toHaveBeenCalled();
  });

  it('PUT answers 400 for an unknown slot, a missing list or too long a list', async () => {
    expect((await put({ slot: 'LAIN', ids: [] })).status).toBe(400);
    expect((await put({ slot: 'PILIHAN' })).status).toBe(400);
    expect((await put({ slot: 'PILIHAN', ids: Array.from({ length: 51 }, (_, i) => `c${i}`) })).status).toBe(400);
    expect(mockSetCampaigns).not.toHaveBeenCalled();
  });

  it('PUT answers 400 when an id names nothing', async () => {
    mockSetCampaigns.mockResolvedValue('UNKNOWN_ID');
    const res = await put({ slot: 'PILIHAN', ids: ['ghost'] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/tidak ditemukan/i);
  });

  it('PUT answers 409 when a concurrent save hit the same slot (unique violation, P2002)', async () => {
    mockSetCampaigns.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    const res = await put({ slot: 'PILIHAN', ids: ['a'] });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Coba simpan lagi/);
  });

  it('PUT does not mistake any other database error for a conflict', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSetPrayers.mockRejectedValue(new Error('boom'));
    expect((await put({ slot: 'SOROTAN_DOA', ids: ['p1'] })).status).toBe(500);
  });
});
