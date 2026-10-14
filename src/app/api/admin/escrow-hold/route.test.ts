import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The Admin Escrow Hold editor (ticket 90): POST sets a new length for the
 * default or one Category. ADMIN only, append-only, every change recorded
 * with its actor.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { escrowHoldSetting: { create: vi.fn(), findFirst: vi.fn() } },
}));

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const mockCreate = prisma.escrowHoldSetting.create as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/escrow-hold';

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
}

describe('POST /api/admin/escrow-hold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockCreate.mockImplementation(async ({ data }) => ({ id: 's-1', ...data }));
  });

  it('answers 401 with no session', async () => {
    mockSession.mockResolvedValue(null);
    const res = await post({ scope: 'DEFAULT', days: 7 });
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('answers 403 for a session without the ADMIN assignment', async () => {
    mockSession.mockResolvedValue({ user: { id: 'v-1', assignments: ['VERIFIER'] } });
    const res = await post({ scope: 'DEFAULT', days: 7 });
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('sets the default length as the acting Admin', async () => {
    const res = await post({ scope: 'DEFAULT', days: 10 });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith({
      data: { scope: 'DEFAULT', category: null, days: 10, setById: 'admin-1' },
    });
  });

  it('sets a Category override', async () => {
    const res = await post({ scope: 'CATEGORY', category: 'bencana', days: 2 });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith({
      data: { scope: 'CATEGORY', category: 'bencana', days: 2, setById: 'admin-1' },
    });
  });

  it.each([0, -3, 1.5, 31, '7', null])('refuses days = %s with 400 and writes nothing', async (days) => {
    const res = await post({ scope: 'DEFAULT', days });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Escrow Hold/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a Category override with no category', async () => {
    const res = await post({ scope: 'CATEGORY', days: 3 });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a JSON object', async () => {
    expect((await post('not json')).status).toBe(400);
    expect((await post([1])).status).toBe(400);
  });

  it('exposes no way to edit or delete an existing row', async () => {
    const route = await import('./route');
    expect(Object.keys(route).sort()).toEqual(['POST']);
  });
});
