import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/user/payouts/[id]/resubmit -- the Fundraiser answers a revision
 * request (PKS Pasal 4.5). Thin route over resubmitPayout: who may (only the
 * subject's Fundraiser) and in what status are the money layer's, answered
 * through refusalResponse.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock('@/lib/money/payouts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/money/payouts')>();
  return { ...actual, resubmitPayout: vi.fn() };
});

import { POST } from './route';
import { getServerSession } from '@/lib/auth';
import { resubmitPayout, InvalidPayoutStatusError, PayoutNotFoundError } from '@/lib/money/payouts';
import { NotAuthorizedError } from '@/lib/capacity';
import { prisma } from '@/lib/prisma';

const mockSession = getServerSession as unknown as Mock;
const mockAction = resubmitPayout as unknown as Mock;

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://localhost:3000/api/user/payouts/payout-1/resubmit', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'payout-1' }) },
  );
}

describe('POST /api/user/payouts/[id]/resubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'fundraiser-1', assignments: [] } });
    mockAction.mockResolvedValue({ id: 'payout-1', amount: 500_000, status: 'DRAFT' });
  });

  it('answers 401 with no session, without calling the money layer', async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({})).status).toBe(401);
    expect(mockAction).not.toHaveBeenCalled();
  });

  it('resubmits as the signed-in user with the note and description and answers 200', async () => {
    const res = await post({ note: 'RAB terbaru terlampir', description: 'Tahap 1 (revisi)' });

    expect(res.status).toBe(200);
    expect(mockAction).toHaveBeenCalledWith(expect.anything(), {
      payoutId: 'payout-1',
      requestedById: 'fundraiser-1',
      note: 'RAB terbaru terlampir',
      description: 'Tahap 1 (revisi)',
    });
    expect(await res.json()).toMatchObject({ id: 'payout-1', status: 'DRAFT' });
  });

  it('accepts an empty body: nothing to change, only resubmit', async () => {
    const res = await post('');

    expect(res.status).toBe(200);
    expect(mockAction).toHaveBeenCalledWith(expect.anything(), { payoutId: 'payout-1', requestedById: 'fundraiser-1', note: undefined, description: undefined });
  });

  it('answers 403 for a team member the money layer refuses', async () => {
    mockAction.mockRejectedValue(new NotAuthorizedError('Anggota tim lembaga tidak dapat mengajukan pencairan.'));
    expect((await post({})).status).toBe(403);
  });

  it('answers a user who did not request the Payout exactly as it answers a Payout that does not exist: no id-existence leak', async () => {
    // The real money layer over a stub transaction: the route is the thing under test.
    const actual = await vi.importActual<typeof import('@/lib/money/payouts')>('@/lib/money/payouts');
    mockAction.mockImplementation(actual.resubmitPayout as never);
    const answerFor = async (row: Record<string, unknown> | null) => {
      (prisma.$transaction as unknown as Mock).mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({ payout: { findUnique: vi.fn().mockResolvedValue(row) } }),
      );
      const res = await post({});
      return { status: res.status, body: await res.json() };
    };

    const missing = await answerFor(null);
    const someoneElses = await answerFor({
      id: 'payout-1',
      campaignId: 'campaign-1',
      volunteerTripId: null,
      requestedById: 'another-fundraiser',
      status: 'REVISION_REQUESTED',
    });

    expect(missing.status).toBe(404);
    expect(someoneElses).toEqual(missing);
  });

  it('answers 404 for a Payout that does not exist and 409 for the wrong status', async () => {
    mockAction.mockRejectedValue(new PayoutNotFoundError('payout-1'));
    expect((await post({})).status).toBe(404);

    mockAction.mockRejectedValue(new InvalidPayoutStatusError('DRAFT'));
    expect((await post({})).status).toBe(409);
  });
});
