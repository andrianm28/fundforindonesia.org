import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/** ADMIN-only rename and delete of one Category; delete is refused while a Campaign uses it. */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    category: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    campaign: { count: vi.fn() },
  },
}));

import { PATCH, DELETE } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const mockFindUnique = prisma.category.findUnique as unknown as Mock;
const mockUpdate = prisma.category.update as unknown as Mock;
const mockDelete = prisma.category.delete as unknown as Mock;
const mockCount = prisma.campaign.count as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/categories/c1';
const ctx = { params: Promise.resolve({ id: 'c1' }) };
const existing = { id: 'c1', name: 'Masjid', slug: 'masjid', icon: '🕌', order: 1 };

function patch(body: unknown) {
  return PATCH(new NextRequest(URL, { method: 'PATCH', body: JSON.stringify(body) }), ctx);
}
const del = () => DELETE(new NextRequest(URL, { method: 'DELETE' }), ctx);

describe('/api/admin/categories/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockFindUnique.mockImplementation(async ({ where }) => (where.id === 'c1' ? existing : null));
    mockUpdate.mockImplementation(async ({ data }) => ({ ...existing, ...data }));
    mockCount.mockResolvedValue(0);
  });

  it('answers 404 to someone who is not an Admin and changes nothing', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u-1', assignments: [] } });

    expect((await patch({ name: 'Baru' })).status).toBe(404);
    expect((await del()).status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('renames a category and leaves its slug alone', async () => {
    const res = await patch({ name: ' Masjid Raya ' });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { name: 'Masjid Raya' } });
  });

  it('answers 400 when the slug is sent, or nothing, or a blank name', async () => {
    expect((await patch({ slug: 'lain' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ name: '' })).status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('answers 409 when the new name belongs to another category', async () => {
    mockFindUnique.mockImplementation(async ({ where }) =>
      where.id === 'c1' ? existing : where.name ? { id: 'c2', name: where.name } : null
    );
    const res = await patch({ name: 'Sekolah' });
    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('answers 409, not 500, when a concurrent rename wins the unique race', async () => {
    mockFindUnique.mockImplementation(async ({ where }) => (where.id === 'c1' ? existing : null));
    mockUpdate.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    const res = await patch({ name: 'Sekolah' });
    expect(res.status).toBe(409);
  });

  it('answers 404 for a category that does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect((await patch({ name: 'Baru' })).status).toBe(404);
    expect((await del()).status).toBe(404);
  });

  it('refuses to delete a category a Campaign uses with 409', async () => {
    mockCount.mockResolvedValue(2);

    const res = await del();

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('2 Campaign');
    expect(mockCount).toHaveBeenCalledWith({ where: { category: 'masjid' } });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes an unused category with 204', async () => {
    const res = await del();

    expect(res.status).toBe(204);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });
});
