import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/money/donor-refunds', () => ({ requestDonorRefund: vi.fn() }));

import { POST } from './route';
import { getServerSession } from '@/lib/auth';
import { requestDonorRefund } from '@/lib/money/donor-refunds';
import { DonorRefundDisabledError, DonorRefundNotEligibleError, DonorRefundTooManyOpenError } from '@/lib/money/donor-refund-errors';

const session = getServerSession as unknown as Mock;
const request = requestDonorRefund as unknown as Mock;

const call = (body: unknown) =>
  POST(
    new NextRequest('http://localhost:3000/api/donations/don-1/refund-request', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'don-1' }) },
  );

beforeEach(() => {
  session.mockReset().mockResolvedValue({ user: { id: 'donor-1' } });
  request.mockReset().mockResolvedValue({ id: 'refund-1', amount: 50_000, status: 'REQUESTED' });
});

describe('POST /api/donations/[id]/refund-request', () => {
  it('answers 401 without a session and calls nothing', async () => {
    session.mockResolvedValue(null);
    expect((await call({ amount: 1, reason: 'x' })).status).toBe(401);
    expect(request).not.toHaveBeenCalled();
  });

  it('answers 400 for a malformed body', async () => {
    expect((await call({ amount: '50000', reason: 'x' })).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it('creates the request as the signed-in user, never as a donorId from the body', async () => {
    const res = await call({ amount: 50_000, reason: 'Salah nominal', donorId: 'someone-else' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'refund-1', amount: 50_000, status: 'REQUESTED' });
    expect(request).toHaveBeenCalledWith({}, { donorId: 'donor-1', donationId: 'don-1', amount: 50_000, reason: 'Salah nominal' });
  });

  it.each([
    [new DonorRefundDisabledError(), 403, 'DONOR_REFUND_DISABLED'],
    [new DonorRefundNotEligibleError('WINDOW_CLOSED'), 409, 'DONOR_REFUND_NOT_ELIGIBLE'],
    [new DonorRefundNotEligibleError('NOT_OWNER'), 404, 'DONOR_REFUND_NOT_ELIGIBLE'],
    [new DonorRefundTooManyOpenError(), 429, 'DONOR_REFUND_TOO_MANY_OPEN'],
  ])('maps %s to %i', async (error, status, code) => {
    request.mockRejectedValue(error);
    const res = await call({ amount: 50_000, reason: 'x' });
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });
});
