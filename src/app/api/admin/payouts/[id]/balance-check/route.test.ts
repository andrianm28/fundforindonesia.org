import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/admin/payouts/[id]/balance-check -- thin route over
 * recordPayoutBalanceShort (ticket 30). Every rule (DRAFT-only, the
 * two-person rule, the reading actually being short) lives in the money
 * layer and is unit-tested there (src/lib/money/payouts.test.ts); this test
 * only pins the assignment gate, the session wiring, and that a refusal is
 * answered through refusalResponse rather than a generic 500.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/money/payouts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/money/payouts')>();
  return {
    ...actual,
    recordPayoutBalanceShort: vi.fn(),
  };
});

import { POST } from './route';
import { getServerSession } from '@/lib/auth';
import { recordPayoutBalanceShort, SelfApprovalError, ProviderBalanceNotShortError } from '@/lib/money/payouts';

const mockSession = getServerSession as unknown as Mock;
const mockRecord = recordPayoutBalanceShort as unknown as Mock;

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://localhost:3000/api/admin/payouts/payout-1/balance-check', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'payout-1' }) },
  );
}

describe('POST /api/admin/payouts/[id]/balance-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } });
    mockRecord.mockResolvedValue({
      id: 'check-1',
      payoutId: 'payout-1',
      provider: 'sumopod',
      recordedBalance: 300_000,
      checkedAt: new Date('2026-09-28'),
    });
  });

  it('answers 401 with no session and 403 without the ADMIN assignment', async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ provider: 'sumopod', providerBalance: 300_000 })).status).toBe(401);

    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
    expect((await post({ provider: 'sumopod', providerBalance: 300_000 })).status).toBe(403);

    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('records as the signed-in Admin and answers 200 with the check row', async () => {
    const res = await post({ provider: 'sumopod', providerBalance: 300_000 });

    expect(res.status).toBe(200);
    expect(mockRecord).toHaveBeenCalledWith(expect.anything(), {
      payoutId: 'payout-1',
      checkedById: 'admin-2',
      provider: 'sumopod',
      providerBalance: 300_000,
    });
    const body = await res.json();
    expect(body).toMatchObject({ id: 'check-1', provider: 'sumopod', recordedBalance: 300_000 });
  });

  it('answers the two-person rule refusal through refusalResponse, not a generic 500', async () => {
    mockRecord.mockRejectedValue(new SelfApprovalError('Payout', 'balance_check'));

    const res = await post({ provider: 'sumopod', providerBalance: 300_000 });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('SELF_APPROVAL');
  });

  it('answers PROVIDER_BALANCE_NOT_SHORT (422) when the reading is not actually short', async () => {
    mockRecord.mockRejectedValue(new ProviderBalanceNotShortError(500_000, 500_000));

    const res = await post({ provider: 'sumopod', providerBalance: 500_000 });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('PROVIDER_BALANCE_NOT_SHORT');
  });

  it('answers 500 for an unexpected error', async () => {
    mockRecord.mockRejectedValue(new Error('boom'));

    const res = await post({ provider: 'sumopod', providerBalance: 300_000 });

    expect(res.status).toBe(500);
  });
});
