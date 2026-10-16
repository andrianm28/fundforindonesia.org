import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The two Refund-proposal routes (tickets audit-2026-10-16/07 and
 * rilis-1-benda/80), at the HTTP seam only: a signed-in non-Admin gets 404 and
 * never reaches the money layer; an Admin's refusals keep their own code. The
 * proposal rules are tested against Postgres in
 * src/__tests__/integration/closed-campaign-refund-proposals-real-db.test.ts.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { campaign: { findUnique: vi.fn() } } }));
vi.mock('@/lib/money/campaign-refund-proposals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/money/campaign-refund-proposals')>();
  return { ...actual, proposeCampaignRefunds: vi.fn(), proposeLateSettlementRefund: vi.fn() };
});

import { POST as BULK } from './campaigns/[slug]/refund-proposals/route';
import { POST as LATE } from './refunds/late-settlements/route';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { proposeCampaignRefunds, proposeLateSettlementRefund } from '@/lib/money/campaign-refund-proposals';
import { CampaignNotClosedForRefundProposalError, LateSettlementNotProposableError } from '@/lib/money/errors';

const session = getServerSession as unknown as Mock;
const bulkFn = proposeCampaignRefunds as unknown as Mock;
const lateFn = proposeLateSettlementRefund as unknown as Mock;
const findCampaign = prisma.campaign.findUnique as unknown as Mock;

const bulk = () =>
  BULK(new NextRequest('http://localhost:3000/api/admin/campaigns/c/refund-proposals', { method: 'POST' }), {
    params: Promise.resolve({ slug: 'c' }),
  });
const late = (body: unknown) =>
  LATE(new NextRequest('http://localhost:3000/api/admin/refunds/late-settlements', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  findCampaign.mockResolvedValue({ id: 'campaign-1' });
});

describe.each([
  ['bulk proposal', () => bulk()],
  ['late-settlement refund', () => late({ paymentId: 'p1' })],
])('%s route', (_name, call) => {
  it('answers 401 when signed out', async () => {
    session.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it('answers 404 to a signed-in non-Admin and never reaches the money layer', async () => {
    session.mockResolvedValue({ user: { id: 'u1', assignments: ['VERIFIER'] } });
    const res = await call();
    expect(res.status).toBe(404);
    expect(bulkFn).not.toHaveBeenCalled();
    expect(lateFn).not.toHaveBeenCalled();
  });
});

describe('as an Admin', () => {
  beforeEach(() => session.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } }));

  it('bulk: passes the calling Admin as the requester and returns the result', async () => {
    const result = { created: [], alreadyProposed: 0, skipped: [], paidOut: { count: 0, amount: 0 } };
    bulkFn.mockResolvedValue(result);
    const res = await bulk();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(bulkFn).toHaveBeenCalledWith(expect.anything(), { campaignId: 'campaign-1', actorAdminId: 'admin-1' });
  });

  it('bulk: 404 for an unknown Campaign, 409 for one that is not closed', async () => {
    findCampaign.mockResolvedValueOnce(null);
    expect((await bulk()).status).toBe(404);
    bulkFn.mockRejectedValue(new CampaignNotClosedForRefundProposalError());
    const res = await bulk();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('CAMPAIGN_NOT_CLOSED_FOR_REFUND_PROPOSAL');
  });

  it('late: requires a paymentId, passes the Admin as requester, 409 when the row is stale', async () => {
    expect((await late({})).status).toBe(400);
    lateFn.mockResolvedValue({ id: 'r1', paymentId: 'p1', amount: 100_000, status: 'REQUESTED' });
    const ok = await late({ paymentId: 'p1' });
    expect(ok.status).toBe(201);
    expect(lateFn).toHaveBeenCalledWith(expect.anything(), { paymentId: 'p1', actorAdminId: 'admin-1' });
    lateFn.mockRejectedValue(new LateSettlementNotProposableError());
    const stale = await late({ paymentId: 'p1' });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('LATE_SETTLEMENT_NOT_PROPOSABLE');
  });
});
