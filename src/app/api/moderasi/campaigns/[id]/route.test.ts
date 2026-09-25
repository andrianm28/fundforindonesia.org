import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../../../../../tests/support/in-memory-campaign-db';

/**
 * End to end through the real handler, the real assignment gate and the
 * real lifecycle module. Only the session and the database are stood in:
 * the database is the in-memory Prisma stand-in, so assertions are about
 * the rows a request leaves behind.
 */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] },
  ),
}));

import { PATCH } from './route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;

const VERIFIER = { user: { id: 'verifier-1', role: 'MODERATOR', assignments: ['VERIFIER'] } };

function seed(overrides: Partial<CampaignRow> = {}) {
  state.db = makeCampaignDb({ campaigns: [campaignRow(overrides)] });
}

function patch(body: unknown): Promise<Response> {
  const req = new NextRequest('http://localhost:3000/api/moderasi/campaigns/campaign-1', {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return PATCH(req, { params: Promise.resolve({ id: 'campaign-1' }) });
}

describe('PATCH /api/moderasi/campaigns/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(VERIFIER);
    seed();
  });

  describe('access', () => {
    it('answers 401 without a session and changes nothing', async () => {
      mockSession.mockResolvedValue(null);

      const response = await patch({ action: 'approve' });

      expect(response.status).toBe(401);
      expect(state.db.campaign().lifecycleStatus).toBe('SUBMITTED');
      expect(state.db.statusChanges).toEqual([]);
    });

    it('answers 403 to an ADMIN-ranked user without the Verifier assignment (ADR 0005) and changes nothing', async () => {
      mockSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } });

      const response = await patch({ action: 'approve' });

      expect(response.status).toBe(403);
      expect(state.db.campaign().lifecycleStatus).toBe('SUBMITTED');
      expect(state.db.statusChanges).toEqual([]);
    });

    it('lets a person holding both assignments decide, recorded in the Verifier capacity', async () => {
      mockSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN', 'VERIFIER'] } });

      const response = await patch({ action: 'approve' });

      expect(response.status).toBe(200);
      expect(state.db.statusChanges).toEqual([
        expect.objectContaining({ actorId: 'admin-1', capacity: 'VERIFIER' }),
      ]);
    });
  });

  describe('approve and reject', () => {
    it('approve makes a Submitted Campaign Active and answers with its new status', async () => {
      const response = await patch({ action: 'approve' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        campaign: {
          id: 'campaign-1',
          slug: 'bantu-korban-banjir',
          lifecycleStatus: 'ACTIVE',
          isUrgent: false,
        },
      });
      expect(state.db.campaign()).toMatchObject({ status: 'active', lifecycleStatus: 'ACTIVE' });
      expect(state.db.statusChanges).toEqual([
        expect.objectContaining({
          action: 'SUBMISSION_APPROVED',
          fromStatus: 'SUBMITTED',
          toStatus: 'ACTIVE',
          actorId: 'verifier-1',
          capacity: 'VERIFIER',
        }),
      ]);
    });

    it('reject makes a Submitted Campaign Rejected', async () => {
      const response = await patch({ action: 'reject' });

      expect(response.status).toBe(200);
      expect((await response.json()).campaign.lifecycleStatus).toBe('REJECTED');
      expect(state.db.campaign()).toMatchObject({ status: 'rejected', lifecycleStatus: 'REJECTED' });
      expect(state.db.statusChanges).toEqual([
        expect.objectContaining({ action: 'SUBMISSION_REJECTED', capacity: 'VERIFIER', actorId: 'verifier-1' }),
      ]);
    });

    it.each(['approve', 'reject'])('%s notifies the Fundraiser without the word "moderator"', async (action) => {
      await patch({ action });

      expect(state.db.notifications).toHaveLength(1);
      const [notification] = state.db.notifications;
      expect(notification.userId).toBe('creator-1');
      expect(`${notification.title} ${notification.message}`.toLowerCase()).not.toContain('moderator');
    });
  });

  describe('refusals', () => {
    it.each([
      ['ACTIVE', 'active'],
      ['REJECTED', 'rejected'],
      ['SUSPENDED', 'suspended'],
      ['COMPLETED', 'completed'],
      ['EXPIRED', 'expired'],
      ['CANCELLED', 'cancelled'],
    ] as const)('refuses approve and reject on a %s Campaign with 409, leaving it as it was', async (lifecycleStatus, status) => {
      for (const action of ['approve', 'reject']) {
        seed({ lifecycleStatus, status });

        const response = await patch({ action });

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body.code).toBe('INVALID_TRANSITION');
        expect(body.error).toContain('tidak dapat dilakukan');
        expect(state.db.campaign()).toMatchObject({ lifecycleStatus, status });
        expect(state.db.statusChanges).toEqual([]);
        expect(state.db.notifications).toEqual([]);
      }
    });

    it('can no longer bring a Suspended Campaign back to Active', async () => {
      seed({ lifecycleStatus: 'SUSPENDED', status: 'suspended' });

      const response = await patch({ action: 'approve' });

      expect(response.status).toBe(409);
      expect(state.db.campaign().lifecycleStatus).toBe('SUSPENDED');
    });

    it('records an Active Campaign past its deadline as Expired, then refuses with 409, keeping the expiry', async () => {
      seed({ lifecycleStatus: 'ACTIVE', status: 'active', deadline: new Date('2020-01-01T00:00:00Z') });

      const response = await patch({ action: 'approve' });

      expect(response.status).toBe(409);
      expect(state.db.campaign()).toMatchObject({ status: 'expired', lifecycleStatus: 'EXPIRED' });
      expect(state.db.statusChanges).toEqual([
        expect.objectContaining({ action: 'EXPIRED', capacity: 'SYSTEM', actorId: null }),
      ]);
    });

    it('answers 409 to the loser of two simultaneous decisions', async () => {
      state.db.beforeNextCampaignWrite((data) => {
        Object.assign(data.campaigns[0], { status: 'rejected', lifecycleStatus: 'REJECTED' });
      });

      const response = await patch({ action: 'approve' });

      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('CONCURRENT_TRANSITION');
      expect(state.db.campaign().lifecycleStatus).toBe('REJECTED');
      expect(state.db.statusChanges).toEqual([]);
    });

    it('answers 404 for an unknown Campaign', async () => {
      state.db = makeCampaignDb({ campaigns: [] });

      const response = await patch({ action: 'approve' });

      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe('Campaign tidak ditemukan.');
    });
  });

  describe('unknown actions', () => {
    it('rejects suspend as an unknown action with 400: a Verifier no longer suspends', async () => {
      seed({ lifecycleStatus: 'ACTIVE', status: 'active' });

      const response = await patch({ action: 'suspend' });

      expect(response.status).toBe(400);
      expect(state.db.campaign()).toMatchObject({ status: 'active', lifecycleStatus: 'ACTIVE' });
      expect(state.db.statusChanges).toEqual([]);
    });

    it.each([
      ['a missing action', {}],
      ['an unknown action', { action: 'delete' }],
      ['an inherited object key', { action: 'constructor' }],
      ['a body that is not JSON', 'not json'],
    ])('answers 400 to %s', async (_label, body) => {
      const response = await patch(body);

      expect(response.status).toBe(400);
      expect(state.db.campaign().lifecycleStatus).toBe('SUBMITTED');
    });
  });
});
