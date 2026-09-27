import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Recording a Manual Contribution (prd-compliance 34; PRD FFI-07c).
 *
 * The seam an Admin actually meets: the route is the only thing that decides
 * who may record one, and it must be the ADMIN assignment alone -- a
 * Verifier, however senior, records Payout approvals and Campaign submissions
 * but never money entering the books.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => {
  const tx = {
    manualContribution: { create: vi.fn() },
    campaign: { findUnique: vi.fn() },
    program: { findUnique: vi.fn() },
    // The subject guard takes the Campaign row lock before reading it.
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'campaign-1' }]),
  };
  return { prisma: { ...tx, $transaction: (fn: (client: unknown) => unknown) => fn(tx) } };
});

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const mockCreate = prisma.manualContribution.create as unknown as Mock;
const mockCampaignFind = prisma.campaign.findUnique as unknown as Mock;
const mockProgramFind = prisma.program.findUnique as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/manual-contributions';

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/admin/manual-contributions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockCreate.mockImplementation(async ({ data }) => ({ id: 'mc-1', status: 'PENDING', ...data }));
    mockCampaignFind.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'fundraiser-1',
      isDemo: false,
      lifecycleStatus: 'ACTIVE',
      deadline: null,
      kind: 'DONATION',
      collectingEntityId: 'partner-1',
    });
    mockProgramFind.mockResolvedValue({ id: 'program-1' });
  });

  it('answers 401 with no session, and 403 without the ADMIN assignment', async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ campaignId: 'campaign-1', amount: 1_000, proofReference: 'bukti.pdf' })).status).toBe(401);

    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
    expect((await post({ campaignId: 'campaign-1', amount: 1_000, proofReference: 'bukti.pdf' })).status).toBe(403);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('records a Campaign-targeted contribution and answers 201 with it still PENDING', async () => {
    const res = await post({ campaignId: 'campaign-1', amount: 250_000, proofReference: 'bukti.pdf' });

    expect(res.status).toBe(201);
    // PENDING, not APPROVED: recording puts no money anywhere.
    expect(await res.json()).toMatchObject({ contribution: { id: 'mc-1', status: 'PENDING' } });
  });

  it('records a Program-targeted contribution instead', async () => {
    const res = await post({ programId: 'program-1', amount: 500_000_000, proofReference: 'invoice.pdf' });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ programId: 'program-1', campaignId: null }),
      }),
    );
  });

  it('refuses a body that names both a Campaign and a Program, with the target code', async () => {
    const res = await post({
      campaignId: 'campaign-1',
      programId: 'program-1',
      amount: 1_000,
      proofReference: 'bukti.pdf',
    });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('MANUAL_CONTRIBUTION_TARGET_INVALID');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a contribution with no proof of transfer', async () => {
    const res = await post({ campaignId: 'campaign-1', amount: 250_000 });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('MANUAL_CONTRIBUTION_PROOF_REQUIRED');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a JSON object at all', async () => {
    const res = await POST(
      new NextRequest(URL, { method: 'POST', body: JSON.stringify(['campaign-1']) }),
    );

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
