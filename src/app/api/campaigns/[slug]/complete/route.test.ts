import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../../../../../tests/support/in-memory-campaign-db';

/**
 * End to end through the real handler and the real lifecycle module. Only
 * the session and the database are stood in: the database is the in-memory
 * Prisma stand-in, so assertions are about the rows a request leaves behind.
 */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] },
  ),
}));

import { POST } from './route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;

const OWNER = { user: { id: 'creator-1', role: 'USER', assignments: [] } };
const OWNER_WHO_IS_ADMIN = { user: { id: 'creator-1', role: 'ADMIN', assignments: ['ADMIN'] } };
const ADMIN = { user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } };
const VERIFIER = { user: { id: 'verifier-1', role: 'MODERATOR', assignments: ['VERIFIER'] } };
const STRANGER = { user: { id: 'someone-else', role: 'USER', assignments: [] } };
const REASON = 'Program selesai dan laporan akhir sudah terbit.';

function seed(overrides: Partial<CampaignRow> = {}, { withUpdate = true } = {}) {
  state.db = makeCampaignDb({
    campaigns: [campaignRow({ status: 'active', lifecycleStatus: 'ACTIVE', ...overrides })],
    campaignUpdates: withUpdate ? [{ id: 'update-1', campaignId: 'campaign-1' }] : [],
  });
}

function post(body?: unknown, slug = 'bantu-korban-banjir'): Promise<Response> {
  const req = new NextRequest(`http://localhost:3000/api/campaigns/${slug}/complete`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
  return POST(req, { params: Promise.resolve({ slug }) });
}

function expectUnchanged() {
  expect(state.db.campaign()).toMatchObject({ status: 'active', lifecycleStatus: 'ACTIVE' });
  expect(state.db.statusChanges).toEqual([]);
  expect(state.db.notifications).toEqual([]);
}

describe('POST /api/campaigns/[slug]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(OWNER);
    seed();
  });

  describe('as the owner', () => {
    it('marks the Campaign Completed without a body and answers with its new state', async () => {
      const response = await post();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        campaign: { id: 'campaign-1', slug: 'bantu-korban-banjir', lifecycleStatus: 'COMPLETED', isUrgent: false },
      });
      expect(state.db.campaign()).toMatchObject({ status: 'completed', lifecycleStatus: 'COMPLETED' });
      expect(state.db.statusChanges).toEqual([
        expect.objectContaining({
          action: 'COMPLETED',
          fromStatus: 'ACTIVE',
          toStatus: 'COMPLETED',
          actorId: 'creator-1',
          capacity: 'FUNDRAISER',
          reason: null,
        }),
      ]);
      expect(state.db.notifications).toEqual([]);
    });

    it('records an optional reason', async () => {
      const response = await post({ reason: REASON });

      expect(response.status).toBe(200);
      expect(state.db.statusChanges[0].reason).toBe(REASON);
    });

    it('acts as Fundraiser even when also holding ADMIN, needing no reason', async () => {
      mockSession.mockResolvedValue(OWNER_WHO_IS_ADMIN);

      const response = await post({});

      expect(response.status).toBe(200);
      expect(state.db.statusChanges).toEqual([
        expect.objectContaining({ action: 'COMPLETED', actorId: 'creator-1', capacity: 'FUNDRAISER' }),
      ]);
      expect(state.db.notifications).toEqual([]);
    });
  });

  describe('as an Admin who does not own the Campaign', () => {
    beforeEach(() => mockSession.mockResolvedValue(ADMIN));

    it('marks it Completed with a reason and notifies the Fundraiser with that reason', async () => {
      const response = await post({ reason: REASON });

      expect(response.status).toBe(200);
      expect((await response.json()).campaign.lifecycleStatus).toBe('COMPLETED');
      expect(state.db.statusChanges).toEqual([
        expect.objectContaining({ action: 'COMPLETED', actorId: 'admin-1', capacity: 'ADMIN', reason: REASON }),
      ]);
      expect(state.db.notifications).toEqual([
        expect.objectContaining({ userId: 'creator-1', link: '/campaign/bantu-korban-banjir' }),
      ]);
      expect(state.db.notifications[0].message).toContain(REASON);
    });

    it.each([
      ['no body', undefined],
      ['no reason', {}],
      ['a blank reason', { reason: '  ' }],
      ['a reason longer than 1000 characters', { reason: 'a'.repeat(1001) }],
      ['malformed JSON', '{not json'],
    ])('answers 400 to %s and changes nothing', async (_label, body) => {
      const response = await post(body);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'VALIDATION', error: expect.any(String) });
      expectUnchanged();
    });

    it('clears Urgent on completion and answers with isUrgent false', async () => {
      seed({ isUrgent: true });

      const response = await post({ reason: REASON });

      expect((await response.json()).campaign.isUrgent).toBe(false);
      expect(state.db.campaign().isUrgent).toBe(false);
      expect(state.db.statusChanges.map((s) => [s.action, s.capacity])).toEqual([
        ['COMPLETED', 'ADMIN'],
        ['URGENT_CLEARED', 'SYSTEM'],
      ]);
    });
  });

  describe('access', () => {
    it('answers 401 without a session and changes nothing', async () => {
      mockSession.mockResolvedValue(null);

      const response = await post({ reason: REASON });

      expect(response.status).toBe(401);
      expectUnchanged();
    });

    it.each([
      ['a Verifier', VERIFIER],
      ['a person with no assignment', STRANGER],
    ])('answers 403 to %s who does not own the Campaign and changes nothing', async (_label, session) => {
      mockSession.mockResolvedValue(session);

      const response = await post({ reason: REASON });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'NOT_AUTHORIZED', error: expect.any(String) });
      expectUnchanged();
    });

    it('answers 404 for an unknown slug', async () => {
      const response = await post({ reason: REASON }, 'tidak-ada');

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'CAMPAIGN_NOT_FOUND' });
      expectUnchanged();
    });
  });

  describe.each([
    ['the owner', OWNER],
    ['an Admin', ADMIN],
  ])('refusals, for %s', (_label, session) => {
    beforeEach(() => mockSession.mockResolvedValue(session));

    it('answers 422 while the Campaign has no Campaign Update', async () => {
      seed({}, { withUpdate: false });

      const response = await post({ reason: REASON });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'MISSING_CAMPAIGN_UPDATE', error: expect.stringContaining('Campaign Update') });
      expectUnchanged();
    });

    it.each([
      ['SUBMITTED', 'pending'],
      ['REJECTED', 'rejected'],
      ['SUSPENDED', 'suspended'],
      ['EXPIRED', 'expired'],
      ['CANCELLED', 'cancelled'],
      ['COMPLETED', 'completed'],
    ] as const)('answers 409 for a %s Campaign, leaving it as it was', async (lifecycleStatus, status) => {
      seed({ lifecycleStatus, status });

      const response = await post({ reason: REASON });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
      expect(state.db.campaign()).toMatchObject({ lifecycleStatus, status });
      expect(state.db.statusChanges).toEqual([]);
    });

    it('records an Active Campaign past its deadline as Expired and answers 409', async () => {
      seed({ deadline: new Date('2020-01-01T00:00:00Z') });

      const response = await post({ reason: REASON });

      expect(response.status).toBe(409);
      expect(state.db.campaign()).toMatchObject({ status: 'expired', lifecycleStatus: 'EXPIRED' });
      expect(state.db.statusChanges).toEqual([
        expect.objectContaining({ action: 'EXPIRED', capacity: 'SYSTEM', actorId: null }),
      ]);
    });
  });

  it('of two simultaneous completions, one changes the Campaign and the other answers 409', async () => {
    mockSession.mockResolvedValue(ADMIN);
    state.db.beforeNextCampaignWrite((data) => {
      Object.assign(data.campaigns[0], { status: 'completed', lifecycleStatus: 'COMPLETED' });
      data.statusChanges.push({
        id: 'change-other',
        campaignId: 'campaign-1',
        action: 'COMPLETED',
        fromStatus: 'ACTIVE',
        toStatus: 'COMPLETED',
        actorId: 'creator-1',
        capacity: 'FUNDRAISER',
        reason: null,
        createdAt: new Date(),
      });
    });

    const response = await post({ reason: REASON });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'CONCURRENT_TRANSITION' });
    expect(state.db.campaign().lifecycleStatus).toBe('COMPLETED');
    expect(state.db.statusChanges).toEqual([expect.objectContaining({ id: 'change-other' })]);
    expect(state.db.notifications).toEqual([]);
  });

  it('answers 500 without leaking details when the database fails unexpectedly', async () => {
    const failing = { ...state.db.prisma, $transaction: async () => { throw new Error('connection reset'); } };
    const db = state.db;
    state.db = { ...db, prisma: failing } as typeof db;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await post({ reason: REASON });

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('connection reset');
  });
});
