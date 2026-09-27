import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The Admin's abuse thresholds (prd-compliance 38, PRD §"Anti penyalahgunaan").
 * ADMIN only, append-only: the row it inserts carries the Admin and the time,
 * and the latest row of a kind is the one in force.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { abuseThreshold: { create: vi.fn(), findMany: vi.fn() } },
}));

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const mockCreate = prisma.abuseThreshold.create as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/abuse-thresholds';

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/admin/abuse-thresholds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockCreate.mockImplementation(async ({ data }) => ({ id: 'threshold-1', ...data }));
  });

  it('sets the limit as the acting Admin', async () => {
    const res = await post({ kind: 'CAMPAIGN_REVIEW_GROSS', value: 250_000_000 });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      threshold: { kind: 'CAMPAIGN_REVIEW_GROSS', value: 250_000_000, setById: 'admin-1' },
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'CAMPAIGN_REVIEW_GROSS', value: 250_000_000, setById: 'admin-1' }),
    });
  });

  it('sets the Active Campaign count like any other limit', async () => {
    const res = await post({ kind: 'ACTIVE_CAMPAIGNS_PER_FUNDRAISER', value: 5 });

    expect(res.status).toBe(201);
  });

  it('answers 401 with no session, and 403 for anyone who is not an Admin', async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ kind: 'DONATION_REVIEW_AMOUNT', value: 20_000_000 })).status).toBe(401);

    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
    expect((await post({ kind: 'DONATION_REVIEW_AMOUNT', value: 20_000_000 })).status).toBe(403);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a limit that is not a whole amount above zero, without writing anything', async () => {
    const res = await post({ kind: 'DONATION_REVIEW_AMOUNT', value: -5 });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/bilangan bulat lebih besar dari 0/);    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a kind that is not one of the four, without writing anything', async () => {
    const res = await post({ kind: 'CAMPAIGN_TITLE_LENGTH', value: 100 });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/tidak dikenal/);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
