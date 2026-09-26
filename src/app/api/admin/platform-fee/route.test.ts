import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The Admin Platform Fee editor (prd-compliance 17): POST sets a new rate
 * (KIND/CATEGORY/CAMPAIGN scope) or a new waiver threshold. ADMIN only,
 * every change recorded (setById/setAt, src/lib/money/platform-fee-config.ts).
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformFeeRule: { create: vi.fn(), findFirst: vi.fn() },
    platformFeeThreshold: { create: vi.fn(), findFirst: vi.fn() },
  },
}));

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const mockRuleCreate = prisma.platformFeeRule.create as unknown as Mock;
const mockThresholdCreate = prisma.platformFeeThreshold.create as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/platform-fee';

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/admin/platform-fee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockRuleCreate.mockImplementation(async ({ data }) => ({ id: 'rule-1', ...data }));
    mockThresholdCreate.mockImplementation(async ({ data }) => ({ id: 'threshold-1', ...data }));
  });

  it('answers 401 with no session', async () => {
    mockSession.mockResolvedValue(null);

    const res = await post({ target: 'threshold', amount: 50_000 });

    expect(res.status).toBe(401);
    expect(mockThresholdCreate).not.toHaveBeenCalled();
  });

  it('answers 403 for a session without the ADMIN assignment', async () => {
    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });

    const res = await post({ target: 'threshold', amount: 50_000 });

    expect(res.status).toBe(403);
    expect(mockThresholdCreate).not.toHaveBeenCalled();
  });

  it('sets a Kind default rate as the acting Admin', async () => {
    const res = await post({ target: 'rule', scope: 'KIND', kind: 'DONATION', percentBps: 250 });

    expect(res.status).toBe(201);
    expect(mockRuleCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ scope: 'KIND', kind: 'DONATION', percentBps: 250, setById: 'admin-1' }),
    });
  });

  it('sets a Category override', async () => {
    const res = await post({ target: 'rule', scope: 'CATEGORY', category: 'kesehatan', percentBps: 300 });

    expect(res.status).toBe(201);
    expect(mockRuleCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ scope: 'CATEGORY', category: 'kesehatan', percentBps: 300 }),
    });
  });

  it('sets a Campaign override', async () => {
    const res = await post({ target: 'rule', scope: 'CAMPAIGN', campaignId: 'campaign-1', percentBps: 0 });

    expect(res.status).toBe(201);
    expect(mockRuleCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ scope: 'CAMPAIGN', campaignId: 'campaign-1', percentBps: 0 }),
    });
  });

  it('sets the waiver threshold', async () => {
    const res = await post({ target: 'threshold', amount: 50_000 });

    expect(res.status).toBe(201);
    expect(mockThresholdCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 50_000, setById: 'admin-1' }),
    });
  });

  it('answers 400 for an invalid rule (missing kind for scope KIND)', async () => {
    const res = await post({ target: 'rule', scope: 'KIND', percentBps: 250 });

    expect(res.status).toBe(400);
    expect(mockRuleCreate).not.toHaveBeenCalled();
  });

  it('answers 400 for a percentBps above 100%', async () => {
    const res = await post({ target: 'rule', scope: 'KIND', kind: 'DONATION', percentBps: 10_001 });

    expect(res.status).toBe(400);
  });

  it('answers 400 for an unknown target', async () => {
    const res = await post({ target: 'nonsense' });

    expect(res.status).toBe(400);
  });

  it('answers 400 for a non-JSON-object body', async () => {
    const res = await POST(new NextRequest(URL, { method: 'POST', body: 'not json' }));

    expect(res.status).toBe(400);
  });
});
