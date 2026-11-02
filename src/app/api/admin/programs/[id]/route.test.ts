import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/** ADMIN-only single Program read and edit (ticket 78): 404 for anyone else. */
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { program: { findUnique: vi.fn(), update: vi.fn() } },
}));

import { GET, PATCH } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const mockFindUnique = prisma.program.findUnique as unknown as Mock;
const mockUpdate = prisma.program.update as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/programs/p1';
const ctx = { params: Promise.resolve({ id: 'p1' }) };

const get = () => GET(new NextRequest(URL), ctx);
const patch = (body: unknown) => PATCH(new NextRequest(URL, { method: 'PATCH', body: JSON.stringify(body) }), ctx);

const ROW = { id: 'p1', slug: 'klinik', title: 'Klinik', sector: 'HEALTH' };

describe('/api/admin/programs/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockFindUnique.mockResolvedValue(ROW);
    mockUpdate.mockImplementation(async ({ data }) => ({ ...ROW, ...data }));
  });

  it('answers 404 to someone who is not an Admin and touches nothing', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u-1', assignments: [] } });

    expect((await get()).status).toBe(404);
    expect((await patch({ title: 'X' })).status).toBe(404);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('reads one Program', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).program.id).toBe('p1');
  });

  it('answers 404 for a Program that does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect((await patch({ title: 'X' })).status).toBe(404);
  });

  it('edits a Program', async () => {
    const res = await patch({ title: 'Klinik Baru', sector: 'EDUCATION' });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { title: 'Klinik Baru', sector: 'EDUCATION' },
    });
  });

  it('answers 400 with the module message for an invalid change', async () => {
    const res = await patch({ sector: 'SPORTS' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Sektor Program tidak dikenal.');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('answers 400 when nothing changes', async () => {
    const res = await patch({});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Tidak ada perubahan untuk Program.');
  });
});
