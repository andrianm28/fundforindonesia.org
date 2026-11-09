import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/admin/payouts/[id]/request-revision -- thin route over
 * requestPayoutRevision (PKS Pasal 4.5). The rules live in the money layer
 * (src/lib/money/payouts.test.ts); this pins the literal 404 for anyone
 * without ADMIN, the session wiring and that a refusal is answered through
 * refusalResponse rather than a generic 500.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/money/payouts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/money/payouts')>();
  return { ...actual, requestPayoutRevision: vi.fn() };
});

import { POST } from './route';
import { getServerSession } from '@/lib/auth';
import { requestPayoutRevision, InvalidPayoutStatusError, PayoutReasonInvalidError } from '@/lib/money/payouts';

const mockSession = getServerSession as unknown as Mock;
const mockAction = requestPayoutRevision as unknown as Mock;

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://localhost:3000/api/admin/payouts/payout-1/request-revision', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'payout-1' }) },
  );
}

describe('POST /api/admin/payouts/[id]/request-revision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } });
    mockAction.mockResolvedValue({ id: 'payout-1', amount: 500_000, status: 'REVISION_REQUESTED', revisionReason: 'Lampirkan RAB' });
  });

  it('answers 401 with no session and a literal 404 without the ADMIN assignment', async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ reason: 'x' })).status).toBe(401);

    for (const assignments of [['VERIFIER'], [], ['CAMPAIGN_CREATOR']]) {
      mockSession.mockResolvedValue({ user: { id: 'someone', assignments } });
      const res = await post({ reason: 'x' });
      expect(res.status).toBe(404);
    }

    expect(mockAction).not.toHaveBeenCalled();
  });

  it('acts as the signed-in Admin with the reason and answers 200', async () => {
    const res = await post({ reason: 'Lampirkan RAB' });

    expect(res.status).toBe(200);
    expect(mockAction).toHaveBeenCalledWith(expect.anything(), {
      payoutId: 'payout-1',
      requestedById: 'admin-2',
      reason: 'Lampirkan RAB',
    });
    expect(await res.json()).toMatchObject({ id: 'payout-1', status: 'REVISION_REQUESTED', revisionReason: 'Lampirkan RAB' });
  });

  it('passes a missing or non-string reason on as blank, for the money layer to refuse (400)', async () => {
    mockAction.mockRejectedValue(new PayoutReasonInvalidError('Alasan wajib diisi.'));

    const res = await post({ reason: 42 });

    expect(mockAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: '' }));
    expect(res.status).toBe(400);
  });

  it('answers a refusal through refusalResponse (409), not a generic 500', async () => {
    mockAction.mockRejectedValue(new InvalidPayoutStatusError('APPROVED'));

    const res = await post({ reason: 'x' });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'INVALID_PAYOUT_STATUS' });
  });

  it('answers 500 for an unexpected failure without leaking it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAction.mockRejectedValue(new Error('connection string postgres://secret'));

    const res = await post({ reason: 'x' });

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('postgres');
    errors.mockRestore();
  });
});
