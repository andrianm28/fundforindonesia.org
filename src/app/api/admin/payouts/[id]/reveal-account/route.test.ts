import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/money/payout-reveal', () => ({ revealPayoutAccountNumber: vi.fn() }));

import { POST } from './route';
import { getServerSession } from '@/lib/auth';
import { revealPayoutAccountNumber } from '@/lib/money/payout-reveal';
import { TwoPersonRuleError } from '@/lib/money/errors';

const mockSession = getServerSession as unknown as Mock;
const mockReveal = revealPayoutAccountNumber as unknown as Mock;

function post(): Promise<Response> {
  return POST(new NextRequest('http://localhost:3000/api/admin/payouts/payout-1/reveal-account', { method: 'POST' }), {
    params: Promise.resolve({ id: 'payout-1' }),
  });
}

describe('POST /api/admin/payouts/[id]/reveal-account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-3', assignments: ['ADMIN'] } });
    mockReveal.mockResolvedValue('1234567890');
  });

  it('answers 401 with no session and 403 without ADMIN, never revealing', async () => {
    mockSession.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    mockSession.mockResolvedValue({ user: { id: 'v-1', assignments: ['VERIFIER'] } });
    expect((await post()).status).toBe(403);
    expect(mockReveal).not.toHaveBeenCalled();
  });

  it('reveals as the signed-in Admin, uncached', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ accountNumber: '1234567890' });
    expect(mockReveal).toHaveBeenCalledWith(expect.anything(), { payoutId: 'payout-1', revealedById: 'admin-3' });
  });

  it('answers a refusal through refusalResponse, not a 500', async () => {
    mockReveal.mockRejectedValue(new TwoPersonRuleError());
    const res = await post();
    expect(res.status).toBeLessThan(500);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
