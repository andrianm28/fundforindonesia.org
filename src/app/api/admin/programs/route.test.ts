import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * ADMIN-only Program list and create (ticket 78): 404 for anyone else
 * (ticket 90), the module's refusals as 400. Real handler and real
 * src/lib/programs.ts, with the session and the database stood in.
 */
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { program: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() } },
}));

import { GET, POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const mockFindMany = prisma.program.findMany as unknown as Mock;
const mockFindUnique = prisma.program.findUnique as unknown as Mock;
const mockCreate = prisma.program.create as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/programs';

const get = (query = '') => GET(new NextRequest(URL + query));
const post = (body: unknown) => POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));

const VALID = {
  title: 'Klinik Keliling Pesisir',
  sector: 'HEALTH',
  problem: 'Akses layanan kesehatan dasar masih jauh.',
  beneficiaries: '1.000 warga pesisir.',
  location: 'Pesisir Utara',
  activities: 'Pemeriksaan rutin dan rujukan.',
  budget: 500000000,
  timeline: 'Jan–Des 2027',
};

describe('/api/admin/programs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockImplementation(async ({ data }) => ({ id: 'p1', ...data }));
  });

  it('answers 404 to someone who is not an Admin, on both methods, and touches nothing', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u-1', assignments: ['VERIFIER'] } });

    expect((await get()).status).toBe(404);
    expect((await post(VALID)).status).toBe(404);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('answers 401 to a visitor who is not signed in', async () => {
    mockSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect((await post(VALID)).status).toBe(401);
  });

  it('lists every Program, newest first', async () => {
    mockFindMany.mockResolvedValue([{ id: 'p1', title: 'A' }]);

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ programs: [{ id: 'p1', title: 'A' }] });
    expect(mockFindMany).toHaveBeenCalledWith({ where: {}, orderBy: { createdAt: 'desc' } });
  });

  it('narrows the list to a Sector named in any case', async () => {
    mockFindMany.mockResolvedValue([]);
    await get('?sector=education');
    expect(mockFindMany).toHaveBeenCalledWith({ where: { sector: 'EDUCATION' }, orderBy: { createdAt: 'desc' } });
  });

  it('refuses an unknown Sector with 400 instead of an empty list', async () => {
    const res = await get('?sector=sports');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Sektor Program tidak dikenal.');
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('creates a Program with 201 and derives the slug from the title', async () => {
    const res = await post(VALID);

    expect(res.status).toBe(201);
    expect((await res.json()).program.slug).toBe('klinik-keliling-pesisir');
  });

  it('answers 400 with the module message for an invalid Program', async () => {
    const res = await post({ ...VALID, sector: 'SPORTS' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Sektor Program tidak dikenal.');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('answers 400 when the body is not a JSON object', async () => {
    expect((await post([1, 2])).status).toBe(400);
  });
});
