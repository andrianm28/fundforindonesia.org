import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH as reject } from './route';
import { PATCH as fail } from '../fail/route';
import { InvalidRefundStatusError, RefundResolutionActorError } from '@/lib/money/errors';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    refund: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/money/refunds', () => ({ rejectRefund: vi.fn(), failRefund: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { rejectRefund, failRefund } from '@/lib/money/refunds';

const session = getServerSession as unknown as Mock;
const campaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const refundFindUnique = prisma.refund.findUnique as unknown as Mock;

const cases = [
  { name: 'reject', handler: reject, domain: rejectRefund as unknown as Mock, actorKey: 'rejectedById', status: 'REJECTED' },
  { name: 'fail', handler: fail, domain: failRefund as unknown as Mock, actorKey: 'failedById', status: 'FAILED' },
];

function patch(verb: string, body: unknown = { reason: 'alasan' }): NextRequest {
  return new NextRequest(`http://localhost:3000/api/campaigns/c/refunds/refund-1/${verb}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ slug: 'c', id: 'refund-1' }) };

describe.each(cases)('PATCH /api/campaigns/[slug]/refunds/[id]/$name', ({ name, handler, domain, actorKey, status }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } });
    campaignFindUnique.mockResolvedValue({ id: 'campaign-1' });
    refundFindUnique.mockResolvedValue({ payment: { donation: { campaignId: 'campaign-1' } } });
    domain.mockResolvedValue({ id: 'refund-1', paymentId: 'p', amount: 1, status, [actorKey]: 'admin-2' });
  });

  it('returns 401 unauthenticated and 403 for a non-Admin, without calling the domain', async () => {
    session.mockResolvedValue(null);
    expect((await handler(patch(name), ctx)).status).toBe(401);
    session.mockResolvedValue({ user: { id: 'v', assignments: ['VERIFIER'] } });
    expect((await handler(patch(name), ctx)).status).toBe(403);
    expect(domain).not.toHaveBeenCalled();
  });

  it('returns 400 when the reason is not a string', async () => {
    expect((await handler(patch(name, { reason: 1 }), ctx)).status).toBe(400);
    expect(domain).not.toHaveBeenCalled();
  });

  it('returns 404 when the Refund belongs to another Campaign', async () => {
    refundFindUnique.mockResolvedValue({ payment: { donation: { campaignId: 'other' } } });
    expect((await handler(patch(name), ctx)).status).toBe(404);
    expect(domain).not.toHaveBeenCalled();
  });

  it('passes the signed-in Admin and the reason to the domain and answers the new status', async () => {
    const response = await handler(patch(name), ctx);
    expect(response.status).toBe(200);
    expect(domain).toHaveBeenCalledWith(expect.anything(), { refundId: 'refund-1', [actorKey]: 'admin-2', reason: 'alasan' });
    expect(await response.json()).toMatchObject({ status, [actorKey]: 'admin-2' });
  });

  it('answers 409 for a wrong status or a second action, and 403 for the barred actor', async () => {
    domain.mockRejectedValueOnce(new InvalidRefundStatusError('COMPLETED'));
    expect((await handler(patch(name), ctx)).status).toBe(409);
    domain.mockRejectedValueOnce(new RefundResolutionActorError(name as 'reject' | 'fail'));
    expect((await handler(patch(name), ctx)).status).toBe(403);
  });
});
