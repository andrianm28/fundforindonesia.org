import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/user/payouts/[id]/resubmit -- the Fundraiser answers a revision
 * request (PKS Pasal 4.5). Thin route over resubmitPayout: who may (only the
 * subject's Fundraiser) and in what status are the money layer's, answered
 * through refusalResponse.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/money/payouts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/money/payouts')>();
  return { ...actual, resubmitPayout: vi.fn() };
});

import { POST } from './route';
import { getServerSession } from '@/lib/auth';
import { resubmitPayout, InvalidPayoutStatusError, PayoutNotFoundError } from '@/lib/money/payouts';
import { NotAuthorizedError } from '@/lib/capacity';

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

  it('answers 403 for a user who is not the Fundraiser of the subject', async () => {
    mockAction.mockRejectedValue(new NotAuthorizedError('Hanya Fundraiser Campaign ini yang dapat melakukan tindakan ini.'));
    expect((await post({})).status).toBe(403);
  });

  it('answers 404 for a Payout that does not exist and 409 for the wrong status', async () => {
    mockAction.mockRejectedValue(new PayoutNotFoundError('payout-1'));
    expect((await post({})).status).toBe(404);

    mockAction.mockRejectedValue(new InvalidPayoutStatusError('DRAFT'));
    expect((await post({})).status).toBe(409);
  });
});
