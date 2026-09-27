import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The Admin's duplicate-hint threshold (prd-compliance 14, PRD FFI-05: "ambang
 * 0,6 diatur Admin"). ADMIN only, append-only: the row it inserts carries the
 * Admin and the time, and the latest row is the one in force.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { duplicateSimilarityThreshold: { create: vi.fn(), findFirst: vi.fn() } },
}));

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const mockCreate = prisma.duplicateSimilarityThreshold.create as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/duplicate-similarity';

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/admin/duplicate-similarity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockCreate.mockImplementation(async ({ data }) => ({ id: 'threshold-1', ...data }));
  });

  it('sets the threshold as the acting Admin', async () => {
    const res = await post({ threshold: 0.75 });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ threshold: { threshold: 0.75, setById: 'admin-1' } });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ threshold: 0.75, setById: 'admin-1' }),
    });
  });

  it('answers 401 with no session, and 403 for anyone who is not an Admin', async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ threshold: 0.75 })).status).toBe(401);

    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
    expect((await post({ threshold: 0.75 })).status).toBe(403);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a threshold that is no similarity score, without writing anything', async () => {
    const res = await post({ threshold: 1.4 });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/lebih besar dari 0 dan tidak lebih dari 1/);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
