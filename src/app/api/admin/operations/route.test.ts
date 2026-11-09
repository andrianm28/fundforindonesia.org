import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/** ADMIN-only read and change of the operational switches (PKS ticket 01). */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { siteSetting: { findUnique: vi.fn(), upsert: vi.fn() } },
}));

import { GET, POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const mockFindUnique = prisma.siteSetting.findUnique as unknown as Mock;
const mockUpsert = prisma.siteSetting.upsert as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/operations';

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
}
function get(): Promise<Response> {
  return GET();
}

describe('/api/admin/operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', name: 'Dewi Admin', assignments: ['ADMIN'] } });
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({});
  });

  it('lets an Admin read the switches, with the defaults when none was stored', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const { operations } = await res.json();
    expect(operations.donationsOpen).toBe(true);
    expect(operations.maintenance).toEqual({ on: false, message: '' });
  });

  it('lets an Admin switch donations off, recording the acting Admin by id and name', async () => {
    const res = await post({ donationsOpen: false });

    expect(res.status).toBe(200);
    expect((await res.json()).operations.donationsOpen).toBe(false);
    const saved = mockUpsert.mock.calls[0][0];
    expect(saved.where).toEqual({ key: 'operations' });
    expect(saved.update.updatedById).toBe('admin-1');
    expect(saved.update.value.history[0]).toMatchObject({
      actorId: 'admin-1',
      actorName: 'Dewi Admin',
      changes: [{ field: 'donationsOpen', from: true, to: false }],
    });
  });

  it('answers 400 in the Admin\'s language for an invalid change, and for a body that is not an object', async () => {
    const bad = await post({ maintenanceMessage: 'x'.repeat(501) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain('500');
    expect((await post([1])).status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it.each([
    ['not signed in', null],
    ['signed in without an assignment', { user: { id: 'u-1', assignments: [] } }],
    ['a Verifier only', { user: { id: 'v-1', assignments: ['VERIFIER'] } }],
  ])('answers 404, literally, to someone who is %s: neither read nor change', async (_label, session) => {
    mockSession.mockResolvedValue(session);

    const read = await get();
    const write = await post({ donationsOpen: false });

    expect(read.status).toBe(404);
    expect(write.status).toBe(404);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
