import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prayer: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { GET } from './route';
import { PATCH } from './[id]/route';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const session = getServerSession as unknown as Mock;
const findMany = prisma.prayer.findMany as unknown as Mock;
const count = prisma.prayer.count as unknown as Mock;
const updateMany = prisma.prayer.updateMany as unknown as Mock;
const findUnique = prisma.prayer.findUnique as unknown as Mock;
const userFindMany = prisma.user.findMany as unknown as Mock;

const revalidate = revalidatePath as unknown as Mock;
const as = (assignments: string[] | null) =>
  session.mockResolvedValue(assignments ? { user: { id: 'mod-1', assignments } } : null);

const list = (query = '') => GET(new NextRequest(`http://localhost:3000/api/moderasi/prayers${query}`));
const patch = (body: unknown, id = 'p1') =>
  PATCH(
    new NextRequest(`http://localhost:3000/api/moderasi/prayers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(0);
  userFindMany.mockResolvedValue([]);
  updateMany.mockResolvedValue({ count: 1 });
});

describe('the Prayer moderation API is Verifier or Admin only, anyone else gets 404', () => {
  it('answers 401 signed out', async () => {
    as(null);
    expect((await list()).status).toBe(401);
    expect((await patch({ action: 'hide' })).status).toBe(401);
  });

  it.each([[[]], [['CSR_TEAM']], [['DONOR']]])('answers 404 to a signed-in user holding %j, reading and writing nothing', async (assignments) => {
    as(assignments as string[]);
    expect((await list()).status).toBe(404);
    expect((await patch({ action: 'hide' })).status).toBe(404);
    expect(findMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each(['VERIFIER', 'ADMIN'])('lets a holder of %s alone in', async (assignment) => {
    as([assignment]);
    expect((await list()).status).toBe(200);
    expect((await patch({ action: 'hide' })).status).toBe(200);
  });
});

describe('GET /api/moderasi/prayers', () => {
  beforeEach(() => as(['VERIFIER']));

  it('lists visible, not-deleted Prayers by default and the hidden ones on request', async () => {
    await list();
    expect(findMany.mock.calls[0][0].where).toEqual({ deletedAt: null, hidden: false });
    await list('?filter=hidden');
    expect(findMany.mock.calls[1][0].where).toEqual({ deletedAt: null, hidden: true });
    expect((await list('?filter=deleted')).status).toBe(400);
  });

  it('names the Campaign and who hid a Prayer, and never selects the Donor', async () => {
    findMany.mockResolvedValue([
      {
        id: 'p1',
        text: 'doa',
        amiinCount: 2,
        createdAt: new Date('2026-11-01T00:00:00Z'),
        hidden: true,
        hiddenAt: new Date('2026-11-02T00:00:00Z'),
        hiddenById: 'mod-9',
        campaign: { slug: 'banjir', title: 'Banjir' },
      },
    ]);
    userFindMany.mockResolvedValue([{ id: 'mod-9', name: 'Verifier Satu' }]);

    const body = await (await list('?filter=hidden')).json();

    expect(body.prayers[0]).toMatchObject({ id: 'p1', campaignSlug: 'banjir', hidden: true, hiddenByName: 'Verifier Satu' });
    const select = findMany.mock.calls[0][0].select;
    expect(Object.keys(select)).not.toEqual(expect.arrayContaining(['donation']));
    expect(Object.keys(select)).not.toEqual(expect.arrayContaining(['user']));
    expect(Object.keys(select)).not.toEqual(expect.arrayContaining(['userId']));
    expect(Object.keys(select)).not.toEqual(expect.arrayContaining(['donationId']));
  });
});

describe('PATCH /api/moderasi/prayers/[id]', () => {
  beforeEach(() => as(['ADMIN']));

  it('records the moderator and the time when hiding', async () => {
    await patch({ action: 'hide' });
    const { where, data } = updateMany.mock.calls[0][0];
    expect(where).toMatchObject({ id: 'p1', deletedAt: null });
    expect(data).toMatchObject({ hidden: true, hiddenById: 'mod-1' });
    expect(data.hiddenAt).toBeInstanceOf(Date);
  });

  it('records the moderator and the time when deleting', async () => {
    await patch({ action: 'delete' });
    const { data } = updateMany.mock.calls[0][0];
    expect(data).toMatchObject({ deletedById: 'mod-1' });
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it('refuses an unknown action with 400', async () => {
    expect((await patch({ action: 'purge' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('answers 404 for a Prayer that does not exist and 409 for one already deleted', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValueOnce(null);
    expect((await patch({ action: 'hide' })).status).toBe(404);
    findUnique.mockResolvedValueOnce({ id: 'p1', deletedAt: new Date() });
    expect((await patch({ action: 'hide' })).status).toBe(409);
  });

  it('records who and when as the last moderation on every action, and keeps it through show', async () => {
    for (const action of ['hide', 'show', 'delete']) {
      updateMany.mockClear();
      await patch({ action });
      const { data } = updateMany.mock.calls[0][0];
      expect(data).toMatchObject({ lastModeratedById: 'mod-1' });
      expect(data.lastModeratedAt).toBeInstanceOf(Date);
    }
  });

  it('shows a hidden Prayer again: 200', async () => {
    const res = await patch({ action: 'show' });
    expect(res.status).toBe(200);
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ id: 'p1', deletedAt: null, hidden: true });
  });

  it('showing a Prayer that is already visible changes nothing and answers 409', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValueOnce({ id: 'p1', hidden: false, deletedAt: null });
    expect((await patch({ action: 'show' })).status).toBe(409);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('hiding a Prayer that is already hidden answers 409', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValueOnce({ id: 'p1', hidden: true, deletedAt: null });
    expect((await patch({ action: 'hide' })).status).toBe(409);
  });

  it('showing a deleted Prayer answers 409', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValueOnce({ id: 'p1', hidden: false, deletedAt: new Date() });
    expect((await patch({ action: 'show' })).status).toBe(409);
  });

  it('deleting twice: the second answers 409', async () => {
    expect((await patch({ action: 'delete' })).status).toBe(200);
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValueOnce({ id: 'p1', hidden: false, deletedAt: new Date() });
    expect((await patch({ action: 'delete' })).status).toBe(409);
  });

  it('after a change that took effect, refreshes the Prayer feed, the home page and the Campaign pages', async () => {
    for (const action of ['hide', 'show', 'delete']) {
      revalidate.mockClear();
      await patch({ action });
      const paths = revalidate.mock.calls.map((c) => c[0]);
      expect(paths).toEqual(expect.arrayContaining(['/api/prayers', '/', '/campaign/[slug]']));
    }
  });

  it('does not refresh anything when the change was refused', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValueOnce(null);
    await patch({ action: 'hide' });
    expect(revalidate).not.toHaveBeenCalled();
  });
});
