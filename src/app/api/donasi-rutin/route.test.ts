import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

// The service's behaviour is tested against a real Postgres
// (src/__tests__/integration/donasi-rutin-real-db.test.ts). These tests are
// about the HTTP boundary: who may call, what is validated, what is answered.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/recurring-donations/service', () => ({
  createRecurringDonation: vi.fn(),
  listRecurringDonations: vi.fn(),
  stopRecurringDonation: vi.fn(),
}));

import { GET, POST } from './route';
import { POST as stopPost } from './[id]/berhenti/route';
import { getServerSession } from '@/lib/auth';
import { createRecurringDonation, listRecurringDonations, stopRecurringDonation } from '@/lib/recurring-donations/service';

const mockSession = getServerSession as unknown as Mock;
const mockCreate = createRecurringDonation as unknown as Mock;
const mockList = listRecurringDonations as unknown as Mock;
const mockStop = stopRecurringDonation as unknown as Mock;

const valid = { campaignId: 'c1', amount: 50_000, period: 'MONTHLY', startDate: '2026-12-01' };
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/donasi-rutin', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

describe('/api/donasi-rutin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'donor-1' } });
  });

  it('answers 401 to everyone without a session, for all three calls', async () => {
    mockSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await POST(post(valid))).status).toBe(401);
    expect((await stopPost(new Request('http://localhost'), { params: Promise.resolve({ id: 'r1' }) })).status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('registers for the signed-in Donor, whatever donorId the body claims', async () => {
    mockCreate.mockResolvedValue({ ok: true, id: 'r1' });

    const res = await POST(post({ ...valid, donorId: 'someone-else' }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'r1' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ donorId: 'donor-1', campaignId: 'c1', amount: 50_000, period: 'MONTHLY', startDate: new Date('2026-12-01T00:00:00.000Z') }),
    );
  });

  it.each([
    ['an amount below the minimum', { amount: 999 }],
    ['an amount above the maximum', { amount: 1_000_000_001 }],
    ['a fractional amount', { amount: 1500.5 }],
    ['an unknown period', { period: 'WEEKLY' }],
    ['a malformed date', { startDate: '01/12/2026' }],
    ['no campaign', { campaignId: '' }],
  ])('refuses %s with 400 before touching the service', async (_name, patch) => {
    const res = await POST(post({ ...valid, ...patch }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('maps the service refusals to their statuses', async () => {
    mockCreate.mockResolvedValueOnce({ ok: false, error: 'campaign_unavailable' });
    expect((await POST(post(valid))).status).toBe(400);
    mockCreate.mockResolvedValueOnce({ ok: false, error: 'too_many' });
    expect((await POST(post(valid))).status).toBe(409);
  });

  it("lists the signed-in Donor's own", async () => {
    mockList.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith(expect.anything(), 'donor-1');
  });

  it("stops only the signed-in Donor's own and answers 404 otherwise", async () => {
    mockStop.mockResolvedValueOnce({ ok: true });
    expect((await stopPost(new Request('http://localhost'), { params: Promise.resolve({ id: 'r1' }) })).status).toBe(200);
    expect(mockStop).toHaveBeenCalledWith(expect.anything(), { id: 'r1', donorId: 'donor-1' });

    mockStop.mockResolvedValueOnce({ ok: false, error: 'not_found' });
    expect((await stopPost(new Request('http://localhost'), { params: Promise.resolve({ id: 'r2' }) })).status).toBe(404);
  });
});
