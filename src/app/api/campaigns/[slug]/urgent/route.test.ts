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

import { PUT } from './route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;

const ADMIN = { user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } };
const SLUG = 'bantu-korban-banjir';
const REASON = 'Korban banjir bertambah, butuh bantuan segera';

function seed(overrides: Partial<CampaignRow> = {}) {
  state.db = makeCampaignDb({
    campaigns: [campaignRow({ status: 'active', lifecycleStatus: 'ACTIVE', ...overrides })],
  });
}

function put(body: unknown, slug = SLUG): Promise<Response> {
  const req = new NextRequest(`http://localhost:3000/api/campaigns/${slug}/urgent`, {
    method: 'PUT',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return PUT(req, { params: Promise.resolve({ slug }) });
}

describe('PUT /api/campaigns/[slug]/urgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(ADMIN);
    seed();
  });

  describe('success', () => {
    it('sets Urgent on an Active Campaign, answers its state, and logs URGENT_SET as Admin with the reason', async () => {
      const response = await put({ urgent: true, reason: REASON });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        campaign: { id: 'campaign-1', slug: SLUG, lifecycleStatus: 'ACTIVE', isUrgent: true },
      });
      expect(state.db.campaign().isUrgent).toBe(true);
      expect(state.db.statusChanges).toEqual([
        expect.objectContaining({
          campaignId: 'campaign-1',
          action: 'URGENT_SET',
          fromStatus: null,
          toStatus: null,
          actorId: 'admin-1',
          capacity: 'ADMIN',
          reason: REASON,
        }),
      ]);
    });

    it('clears Urgent and logs URGENT_CLEARED as Admin with the reason', async () => {
      seed({ isUrgent: true });

      const response = await put({ urgent: false, reason: 'Kebutuhan sudah terpenuhi' });

      expect(response.status).toBe(200);
      expect((await response.json()).campaign).toMatchObject({ isUrgent: false });
      expect(state.db.campaign().isUrgent).toBe(false);
      expect(state.db.statusChanges).toEqual([
        expect.objectContaining({ action: 'URGENT_CLEARED', actorId: 'admin-1', capacity: 'ADMIN', reason: 'Kebutuhan sudah terpenuhi' }),
      ]);
    });

    it('clears Urgent left on a Suspended Campaign', async () => {
      seed({ status: 'suspended', lifecycleStatus: 'SUSPENDED', isUrgent: true });

      const response = await put({ urgent: false, reason: REASON });

      expect(response.status).toBe(200);
      expect(state.db.campaign().isUrgent).toBe(false);
    });

    it('answers 200 without a log row when Urgent is already in the requested state', async () => {
      seed({ isUrgent: true });

      const response = await put({ urgent: true, reason: REASON });

      expect(response.status).toBe(200);
      expect((await response.json()).campaign).toMatchObject({ isUrgent: true });
      expect(state.db.statusChanges).toEqual([]);
    });

    it('lets a person holding both assignments act, recorded in the Admin capacity', async () => {
      mockSession.mockResolvedValue({ user: { id: 'admin-2', role: 'ADMIN', assignments: ['VERIFIER', 'ADMIN'] } });

      const response = await put({ urgent: true, reason: REASON });

      expect(response.status).toBe(200);
      expect(state.db.statusChanges).toEqual([expect.objectContaining({ actorId: 'admin-2', capacity: 'ADMIN' })]);
    });
  });

  describe('401 and 403', () => {
    it('answers 401 without a session and changes nothing', async () => {
      mockSession.mockResolvedValue(null);

      const response = await put({ urgent: true, reason: REASON });

      expect(response.status).toBe(401);
      expect(state.db.campaign().isUrgent).toBe(false);
      expect(state.db.statusChanges).toEqual([]);
    });

    it.each([
      ['a Verifier', { id: 'verifier-1', role: 'MODERATOR', assignments: ['VERIFIER'] }],
      ['the Fundraiser of the Campaign', { id: 'creator-1', role: 'USER', assignments: [] }],
    ])('answers 403 to %s without the Admin assignment and changes nothing', async (_who, user) => {
      mockSession.mockResolvedValue({ user });

      const response = await put({ urgent: true, reason: REASON });

      expect(response.status).toBe(403);
      expect(state.db.campaign().isUrgent).toBe(false);
      expect(state.db.statusChanges).toEqual([]);
    });

    it.each([true, false])('answers 403 to an Admin who owns the Campaign (urgent: %s) and changes nothing', async (urgent) => {
      seed({ isUrgent: !urgent });
      mockSession.mockResolvedValue({ user: { id: 'creator-1', role: 'ADMIN', assignments: ['ADMIN'] } });

      const response = await put({ urgent, reason: REASON });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'OWN_CAMPAIGN_CONFLICT', error: expect.stringContaining('Admin lain') });
      expect(state.db.campaign().isUrgent).toBe(!urgent);
      expect(state.db.statusChanges).toEqual([]);
    });
  });

  describe('404', () => {
    it('answers 404 for an unknown slug', async () => {
      const response = await put({ urgent: true, reason: REASON }, 'tidak-ada');

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'CAMPAIGN_NOT_FOUND', error: 'Campaign tidak ditemukan.' });
      expect(state.db.statusChanges).toEqual([]);
    });
  });

  describe('409', () => {
    it.each([
      ['SUBMITTED', 'pending'],
      ['SUSPENDED', 'suspended'],
      ['COMPLETED', 'completed'],
      ['CANCELLED', 'cancelled'],
      ['EXPIRED', 'expired'],
    ] as const)('refuses to set Urgent on a %s Campaign and changes nothing', async (lifecycleStatus, status) => {
      seed({ lifecycleStatus, status });

      const response = await put({ urgent: true, reason: REASON });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
      expect(state.db.campaign().isUrgent).toBe(false);
      expect(state.db.statusChanges).toEqual([]);
    });

    it('records an Active Campaign past its deadline as Expired and refuses with 409, keeping the expiry', async () => {
      seed({ deadline: new Date('2020-01-01T00:00:00Z') });

      const response = await put({ urgent: true, reason: REASON });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'INVALID_TRANSITION', error: expect.stringContaining('Expired') });
      expect(state.db.campaign()).toMatchObject({ status: 'expired', lifecycleStatus: 'EXPIRED', isUrgent: false });
      expect(state.db.statusChanges).toEqual([
        expect.objectContaining({ action: 'EXPIRED', capacity: 'SYSTEM' }),
      ]);
    });

    it('answers 409 when the Campaign leaves Active between the read and the write', async () => {
      state.db.beforeNextCampaignWrite((data) => {
        Object.assign(data.campaigns[0], { status: 'suspended', lifecycleStatus: 'SUSPENDED' });
      });

      const response = await put({ urgent: true, reason: REASON });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'CONCURRENT_TRANSITION' });
      expect(state.db.campaign().isUrgent).toBe(false);
      expect(state.db.statusChanges).toEqual([]);
    });
  });

  describe('400', () => {
    it.each([
      ['a missing urgent', { reason: REASON }],
      ['a non-boolean urgent', { urgent: 'true', reason: REASON }],
      ['a body that is not an object', ['urgent']],
    ])('answers 400 to %s and changes nothing', async (_what, body) => {
      const response = await put(body);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'VALIDATION' });
      expect(state.db.statusChanges).toEqual([]);
    });

    it('answers 400 to a body that is not JSON', async () => {
      const response = await put('{not json');

      expect(response.status).toBe(400);
      expect(state.db.statusChanges).toEqual([]);
    });

    it.each([
      ['missing', undefined],
      ['blank', '   '],
      ['too long', 'a'.repeat(1001)],
    ])('answers 400 on the reason field to a %s reason and changes nothing', async (_what, reason) => {
      const response = await put({ urgent: true, reason });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'VALIDATION' });
      expect(state.db.campaign().isUrgent).toBe(false);
      expect(state.db.statusChanges).toEqual([]);
    });
  });
});
