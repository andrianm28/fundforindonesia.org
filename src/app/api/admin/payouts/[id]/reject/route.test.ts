import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/admin/payouts/[id]/reject -- thin route over rejectPayout. The rules
 * live in the money layer (src/lib/money/payouts.test.ts); this pins the
 * assignment gate, the session wiring and that a refusal is answered through
 * refusalResponse rather than a generic 500.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/money/payouts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/money/payouts')>();
  return { ...actual, rejectPayout: vi.fn() };
});

import { POST } from './route';
import { getServerSession } from '@/lib/auth';
import { rejectPayout, InvalidPayoutStatusError } from '@/lib/money/payouts';

const mockSession = getServerSession as unknown as Mock;
const mockAction = rejectPayout as unknown as Mock;

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://localhost:3000/api/admin/payouts/payout-1/reject', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'payout-1' }) },
  );
}

describe('POST /api/admin/payouts/[id]/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } });
    mockAction.mockResolvedValue({ id: 'payout-1', amount: 500_000, status: 'REJECTED', rejectionReason: 'Alasan' });
  });

  it('answers 401 with no session and 403 without the ADMIN assignment', async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ reason: 'x' })).status).toBe(401);

    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
    expect((await post({ reason: 'x' })).status).toBe(403);

    expect(mockAction).not.toHaveBeenCalled();
  });

  it('acts as the signed-in Admin with the reason and answers 200', async () => {
    const res = await post({ reason: 'Alasan' });

    expect(res.status).toBe(200);
    expect(mockAction).toHaveBeenCalledWith(expect.anything(), { payoutId: 'payout-1', rejectedById: 'admin-2', reason: 'Alasan' });
    expect(await res.json()).toMatchObject({ id: 'payout-1', status: 'REJECTED' });
  });

  it('answers a refusal through refusalResponse (409), not a generic 500', async () => {
    mockAction.mockRejectedValue(new InvalidPayoutStatusError('COMPLETED'));

    const res = await post({ reason: 'x' });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('INVALID_PAYOUT_STATUS');
  });
});
