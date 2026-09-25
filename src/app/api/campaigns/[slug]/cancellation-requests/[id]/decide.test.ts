import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  cancellationRequestRow,
  makeCampaignDb,
  type CampaignRow,
  type CancellationRequestRow,
  type PayoutRow,
} from '../../../../../../../tests/support/in-memory-campaign-db';

/**
 * Both decision routes, end to end through the real handlers, the real
 * ADMIN assignment gate and the real lifecycle module. Only the session and
 * the database are stood in (the in-memory Prisma stand-in), so assertions
 * are about the rows a request leaves behind.
 */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] },
  ),
}));

import { POST as approve } from './approve/route';
import { POST as reject } from './reject/route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;

const ADMIN = { user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } };
const ROUTES = { approve, reject };

function seed(
  overrides: {
    campaign?: Partial<CampaignRow>;
    requests?: CancellationRequestRow[];
    payouts?: PayoutRow[];
  } = {},
) {
  state.db = makeCampaignDb({
    campaigns: [
      campaignRow({ status: 'active', lifecycleStatus: 'ACTIVE', ...overrides.campaign }),
      campaignRow({ id: 'campaign-2', slug: 'campaign-lain', creatorId: 'creator-2', status: 'active', lifecycleStatus: 'ACTIVE' }),
    ],
    cancellationRequests: overrides.requests ?? [cancellationRequestRow()],
    payouts: overrides.payouts ?? [],
  });
}

function call(
  decision: keyof typeof ROUTES,
  body: unknown,
  { slug = 'bantu-korban-banjir', id = 'request-1' } = {},
): Promise<Response> {
  const req = new NextRequest(
    `http://localhost:3000/api/campaigns/${slug}/cancellation-requests/${id}/${decision}`,
    {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    },
  );
  return ROUTES[decision](req, { params: Promise.resolve({ slug, id }) });
}

describe('POST /api/campaigns/[slug]/cancellation-requests/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(ADMIN);
    seed();
  });

  it('makes the Campaign Cancelled, marks the request APPROVED, logs it and notifies the Fundraiser', async () => {
    const response = await call('approve', { reason: 'Dana belum dicairkan.' });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaign).toEqual({
      id: 'campaign-1',
      slug: 'bantu-korban-banjir',
      lifecycleStatus: 'CANCELLED',
      isUrgent: false,
    });
    expect(body.cancellationRequest).toMatchObject({
      id: 'request-1',
      status: 'APPROVED',
      decidedById: 'admin-1',
      decisionReason: 'Dana belum dicairkan.',
    });
    expect(state.db.campaign()).toMatchObject({ status: 'cancelled', lifecycleStatus: 'CANCELLED' });
    expect(state.db.statusChanges).toEqual([
      expect.objectContaining({
        action: 'CANCELLED',
        fromStatus: 'ACTIVE',
        toStatus: 'CANCELLED',
        actorId: 'admin-1',
        capacity: 'ADMIN',
        reason: 'Dana belum dicairkan.',
      }),
    ]);
    expect(state.db.notifications).toEqual([expect.objectContaining({ userId: 'creator-1' })]);
    expect(state.db.notifications[0].message).toContain('Dana belum dicairkan.');
    expect(state.db.rowLocks).toEqual(['Campaign:campaign-1']);
  });

  it('clears Urgent as the Campaign leaves Active', async () => {
    seed({ campaign: { isUrgent: true } });

    const response = await call('approve', { reason: 'Alasan.' });

    expect((await response.json()).campaign.isUrgent).toBe(false);
    expect(state.db.campaign().isUrgent).toBe(false);
    expect(state.db.statusChanges.map((s) => s.action)).toEqual(['CANCELLED', 'URGENT_CLEARED']);
  });

  it('answers 409 once a Payout on the Campaign has Completed, changing nothing', async () => {
    seed({ payouts: [{ id: 'payout-1', campaignId: 'campaign-1', status: 'COMPLETED' }] });

    const response = await call('approve', { reason: 'Alasan.' });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('PAYOUT_ALREADY_COMPLETED');
    expect(state.db.campaign().lifecycleStatus).toBe('ACTIVE');
    expect(state.db.cancellationRequest().status).toBe('PENDING');
  });

  it('answers 409 for a Campaign past its deadline: recorded Expired, the request lapses', async () => {
    seed({ campaign: { deadline: new Date('2020-01-01T00:00:00Z') } });

    const response = await call('approve', { reason: 'Alasan.' });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('CANCELLATION_NOT_PENDING');
    expect(state.db.campaign().lifecycleStatus).toBe('EXPIRED');
    expect(state.db.cancellationRequest().status).toBe('SUPERSEDED');
  });

  it('answers 409 for a Campaign that is no longer Active', async () => {
    seed({ campaign: { lifecycleStatus: 'SUSPENDED', status: 'suspended' } });

    const response = await call('approve', { reason: 'Alasan.' });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('INVALID_TRANSITION');
  });
});

describe('POST /api/campaigns/[slug]/cancellation-requests/[id]/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(ADMIN);
    seed();
  });

  it('marks the request REJECTED, leaves the Campaign Active and notifies the Fundraiser with the reason', async () => {
    const response = await call('reject', { reason: 'Masih ada Donor aktif.' });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaign).toMatchObject({ lifecycleStatus: 'ACTIVE' });
    expect(body.cancellationRequest).toMatchObject({
      status: 'REJECTED',
      decidedById: 'admin-1',
      decisionReason: 'Masih ada Donor aktif.',
    });
    expect(state.db.campaign()).toMatchObject({ status: 'active', lifecycleStatus: 'ACTIVE' });
    expect(state.db.statusChanges).toEqual([]);
    expect(state.db.notifications).toEqual([expect.objectContaining({ userId: 'creator-1' })]);
    expect(state.db.notifications[0].message).toContain('Masih ada Donor aktif.');
  });

  it('is allowed after a Payout has Completed', async () => {
    seed({ payouts: [{ id: 'payout-1', campaignId: 'campaign-1', status: 'COMPLETED' }] });

    const response = await call('reject', { reason: 'Alasan.' });

    expect(response.status).toBe(200);
  });
});

describe.each(['approve', 'reject'] as const)('POST .../cancellation-requests/[id]/%s, refused', (decision) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(ADMIN);
    seed();
  });

  function expectUntouched() {
    expect(state.db.cancellationRequest().status).toBe('PENDING');
    expect(state.db.campaign().lifecycleStatus).toBe('ACTIVE');
    expect(state.db.statusChanges).toEqual([]);
    expect(state.db.notifications).toEqual([]);
  }

  it('answers 401 without a session', async () => {
    mockSession.mockResolvedValue(null);

    const response = await call(decision, { reason: 'Alasan.' });

    expect(response.status).toBe(401);
    expectUntouched();
  });

  it.each([
    ['the requesting Fundraiser', { user: { id: 'creator-1', role: 'CAMPAIGN_CREATOR', assignments: [] } }],
    ['a Verifier', { user: { id: 'verifier-1', role: 'MODERATOR', assignments: ['VERIFIER'] } }],
    ['an ADMIN-ranked user without the ADMIN assignment', { user: { id: 'admin-9', role: 'ADMIN', assignments: [] } }],
  ])('answers 403 to %s', async (_label, session) => {
    mockSession.mockResolvedValue(session);

    const response = await call(decision, { reason: 'Alasan.' });

    expect(response.status).toBe(403);
    expectUntouched();
  });

  it('answers 403 to an Admin who owns the Campaign', async () => {
    mockSession.mockResolvedValue({ user: { id: 'creator-1', role: 'ADMIN', assignments: ['ADMIN'] } });

    const response = await call(decision, { reason: 'Alasan.' });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('OWN_CAMPAIGN_CONFLICT');
    expectUntouched();
  });

  it.each([
    ['no reason', {}],
    ['a blank reason', { reason: ' ' }],
    ['a reason over 1000 characters', { reason: 'a'.repeat(1001) }],
    ['a body that is not JSON', 'not json'],
  ])('answers 400 to %s', async (_label, body) => {
    const response = await call(decision, body);

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('VALIDATION');
    expectUntouched();
  });

  it('answers 404 for an unknown slug', async () => {
    const response = await call(decision, { reason: 'Alasan.' }, { slug: 'tidak-ada' });

    expect(response.status).toBe(404);
    expectUntouched();
  });

  it('answers 404 for an unknown request', async () => {
    const response = await call(decision, { reason: 'Alasan.' }, { id: 'tidak-ada' });

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('CANCELLATION_REQUEST_NOT_FOUND');
    expectUntouched();
  });

  it("answers 404 for a request addressed through another Campaign's slug", async () => {
    const response = await call(decision, { reason: 'Alasan.' }, { slug: 'campaign-lain' });

    expect(response.status).toBe(404);
    expectUntouched();
  });

  it.each(['APPROVED', 'REJECTED', 'SUPERSEDED'] as const)(
    'answers 409 when the request is already %s',
    async (status) => {
      seed({ requests: [cancellationRequestRow({ status })] });

      const response = await call(decision, { reason: 'Alasan.' });

      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('CANCELLATION_NOT_PENDING');
      expect(state.db.cancellationRequest().status).toBe(status);
      expect(state.db.statusChanges).toEqual([]);
    },
  );
});
